using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Suggests which of the user's tags a card they're adding or changing goes under, and new tags they might want, for
/// them to add with a click.
/// </summary>
/// <remarks>
/// The card and tags are user-provided, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/tag-suggestions")]
public class TagSuggestionsController(
    FlashCardDbContext dbContext,
    ITagSuggester suggester,
    CachedTagSuggester cachedSuggester,
    ILogger<TagSuggestionsController> logger) : ApiControllerBase
{
    // A few at most, so they fit under the field as small chips.
    public const int MaxSuggestions = 3;

    // How many of a tag's cards, the newest, show the model what goes under it.
    public const int CardsPerTag = 5;

    // How many new tags the Tags page shows.
    public const int NewSuggestionCount = 5;

    // How many of the user's untagged cards, the newest, show the model what still needs a tag.
    public const int MaxUntaggedCards = 50;

    // Asked for on top, since some can be tags the user already has.
    private const int ExtraRequested = 3;

    [HttpPost]
    [ProducesResponseType<IEnumerable<Tag>>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<IEnumerable<Tag>>> Suggest(
        [FromBody] TagSuggestionRequest request,
        CancellationToken cancellationToken)
    {
        var spanish = TextRules.CleanWords(request.Spanish, dedupe: false);
        var english = TextRules.CleanWords(request.English, dedupe: false);
        if (spanish.Count == 0 && english.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Spanish), "Spanish or English is required.");
            return ValidationProblem(ModelState);
        }

        if (!suggester.IsAvailable)
        {
            return ServiceUnavailableProblem("Tag suggestions aren't available.");
        }

        // The user's tags the card doesn't have yet, each with its newest cards. Like the cards, the tags are only ever
        // the user's own.
        var onCard = new HashSet<string>(request.Tags.Select(name => name.Trim()), TextRules.Comparer);
        var tags = (await dbContext.Tags
                .AsNoTracking()
                .WithRecentCards(CardsPerTag)
                .OrderBy(tag => tag.Name)
                .ToListAsync(cancellationToken))
            .Where(tag => !onCard.Contains(tag.Name))
            .ToList();
        if (tags.Count == 0)
        {
            return Ok(new List<Tag>());
        }

        IReadOnlyList<string> suggested;
        try
        {
            suggested = await suggester.SuggestAsync(spanish, english, tags, cancellationToken);
        }
        catch (Exception ex) when (IsUpstreamFailure(ex, cancellationToken))
        {
            logger.LogError(ex, "Suggesting tags failed");
            return BadGatewayProblem("Tag suggestions failed.");
        }

        // Only the user's tags, each once, so a name the model made up or misspelled is left out.
        var suggestions = suggested
            .Select(name => tags.Find(tag => TextRules.SameText(tag.Name, name?.Trim())))
            .OfType<Tag>()
            .Distinct()
            .Take(MaxSuggestions)
            .ToList();
        logger.LogInformation(
            "Suggested {Count} of {TagCount} tags", suggestions.Count, tags.Count);

        return Ok(suggestions);
    }

    /// <summary>
    /// Suggests new tags the user is likely to want, going by their tags and cards, for them to add on the Tags page.
    /// They're the ones from the last time the same tags and cards were asked about, unless refresh asks for new ones.
    /// </summary>
    [HttpGet("new")]
    [ProducesResponseType<IEnumerable<string>>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<IEnumerable<string>>> SuggestNewTags(bool refresh, CancellationToken cancellationToken)
    {
        if (!cachedSuggester.IsAvailable)
        {
            return ServiceUnavailableProblem("Tag suggestions aren't available.");
        }

        var tags = await dbContext.Tags
            .AsNoTracking()
            .WithRecentCards(CardsPerTag)
            .OrderBy(tag => tag.Name)
            .ToListAsync(cancellationToken);
        var untagged = await dbContext.FlashCards
            .AsNoTracking()
            .Where(card => card.Tags.Count == 0)
            .OrderByDescending(card => card.Id)
            .Take(MaxUntaggedCards)
            .WithWords()
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        IReadOnlyList<string> suggested;
        try
        {
            suggested = await cachedSuggester.SuggestNewAsync(
                tags, untagged, NewSuggestionCount + ExtraRequested, refresh, cancellationToken);
        }
        catch (Exception ex) when (IsUpstreamFailure(ex, cancellationToken))
        {
            logger.LogError(ex, "Suggesting new tags failed");
            return BadGatewayProblem("Tag suggestions failed.");
        }

        // Each name once, and none the user already has or that's too long to save.
        var seen = new HashSet<string>(tags.Select(tag => tag.Name), TextRules.Comparer);
        var suggestions = suggested
            .Select(TextRules.Clean)
            .Where(name => name.Length is > 0 and <= Tag.MaxNameLength && seen.Add(name))
            .Take(NewSuggestionCount)
            .ToList();
        logger.LogInformation(
            "Suggested {Count} new tags from {TagCount} tags and {UntaggedCount} untagged cards",
            suggestions.Count, tags.Count, untagged.Count);

        return Ok(suggestions);
    }
}
