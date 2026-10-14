using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Suggests which of the user's tags a card they're adding or changing goes under, for them to add with a click.
/// </summary>
/// <remarks>
/// The card and tags are user-provided, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/tag-suggestions")]
public class TagSuggestionsController(
    FlashCardDbContext dbContext,
    ITagSuggester suggester,
    ILogger<TagSuggestionsController> logger) : ControllerBase
{
    // A few at most, so they fit under the field as small chips.
    public const int MaxSuggestions = 3;

    // How many of a tag's cards, the newest, show the model what goes under it.
    public const int CardsPerTag = 5;

    [HttpPost]
    [ProducesResponseType<IEnumerable<Tag>>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<IEnumerable<Tag>>> Suggest(
        [FromBody] TagSuggestionRequest request,
        CancellationToken cancellationToken)
    {
        var spanish = Words(request.Spanish);
        var english = Words(request.English);
        if (spanish.Count == 0 && english.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Spanish), "Spanish or English is required.");
            return ValidationProblem(ModelState);
        }

        if (!suggester.IsAvailable)
        {
            return Problem("Tag suggestions aren't available.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        // The user's tags the card doesn't have yet, each with its newest cards. Like the cards, the tags are only ever
        // the user's own.
        var onCard = new HashSet<string>(request.Tags.Select(name => name.Trim()), StringComparer.OrdinalIgnoreCase);
        var tags = (await dbContext.Tags
                .AsNoTracking()
                .Include(tag => tag.FlashCards.OrderByDescending(card => card.Id).Take(CardsPerTag))
                .ThenInclude(card => card.Words)
                .OrderBy(tag => tag.Name)
                .AsSplitQuery()
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
        // A timeout surfaces as a cancellation the caller didn't ask for.
        catch (Exception ex) when (ex is HttpRequestException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogError(ex, "Suggesting tags failed");
            return Problem("Tag suggestions failed.", statusCode: StatusCodes.Status502BadGateway);
        }

        // Only the user's tags, each once, so a name the model made up or misspelled is left out.
        var suggestions = suggested
            .Select(name => tags.Find(tag => string.Equals(tag.Name, name?.Trim(), StringComparison.OrdinalIgnoreCase)))
            .OfType<Tag>()
            .Distinct()
            .Take(MaxSuggestions)
            .ToList();
        logger.LogInformation(
            "Suggested {Count} of {TagCount} tags", suggestions.Count, tags.Count);

        return Ok(suggestions);
    }

    // A side's words, trimmed, leaving out blanks.
    private static List<string> Words(List<string> words)
    {
        return words.Select(word => word?.Trim() ?? string.Empty).Where(word => word.Length > 0).ToList();
    }
}
