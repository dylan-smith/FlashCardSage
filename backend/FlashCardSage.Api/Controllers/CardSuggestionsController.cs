using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Suggests new cards that go with the user's cards, for them to add with a click.
/// </summary>
/// <remarks>
/// The cards and suggestions are user-provided or made from them, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/card-suggestions")]
public class CardSuggestionsController(
    FlashCardDbContext dbContext,
    ICardSuggester suggester,
    ILogger<CardSuggestionsController> logger) : ControllerBase
{
    // A handful, so they fit on the page next to the user's cards.
    public const int SuggestionCount = 5;

    // The most cards the suggestions are based on, the newest ones, so a long list doesn't make a long request.
    public const int MaxCardsDescribed = 200;

    // A few more than are shown are asked for, since some can turn out to be cards the user already has.
    private const int ExtraRequested = 3;

    [HttpGet]
    [ProducesResponseType<IEnumerable<CardSuggestion>>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<IEnumerable<CardSuggestion>>> Suggest(
        int? relatedTo, int? tag, CancellationToken cancellationToken)
    {
        if (!suggester.IsAvailable)
        {
            return Problem("Card suggestions aren't available.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .Include(card => card.Words)
            .Include(card => card.Tags.OrderBy(tag => tag.Name))
            .OrderBy(card => card.Id)
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        // The card the suggestions are to be related to, e.g. one just added. It's looked up in the user's cards, so
        // it can't be another user's.
        FlashCard? related = null;
        if (relatedTo is { } relatedId)
        {
            related = cards.Find(card => card.Id == relatedId);
            if (related is null)
            {
                return NotFound();
            }
        }

        // The tag whose cards the user is looking at, which the suggestions are to go under. Like the card, it's looked
        // up in the user's tags.
        Tag? selectedTag = null;
        if (tag is { } tagId)
        {
            selectedTag = await dbContext.Tags
                .AsNoTracking()
                .SingleOrDefaultAsync(item => item.Id == tagId, cancellationToken);
            if (selectedTag is null)
            {
                return NotFound();
            }
        }

        // The newest cards, but with a tag, its cards come before the others, so a long list can't leave them out.
        var described = cards
            .OrderBy(card => selectedTag is not null && card.Tags.Any(item => item.Id == selectedTag.Id))
            .ThenBy(card => card.Id)
            .TakeLast(MaxCardsDescribed)
            .OrderBy(card => card.Id)
            .ToList();

        IReadOnlyList<CardSuggestion> suggested;
        try
        {
            suggested = await suggester.SuggestAsync(
                described, related, selectedTag, SuggestionCount + ExtraRequested, cancellationToken);
        }
        // A timeout surfaces as a cancellation the caller didn't ask for.
        catch (Exception ex) when (ex is HttpRequestException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogError(ex, "Suggesting cards failed");
            return Problem("Card suggestions failed.", statusCode: StatusCodes.Status502BadGateway);
        }

        var suggestions = NewCards.From(suggested, cards).Take(SuggestionCount).ToList();
        logger.LogInformation(
            "Suggested {Count} of {Requested} cards from {CardCount} cards", suggestions.Count, suggested.Count, cards.Count);

        return Ok(suggestions);
    }
}
