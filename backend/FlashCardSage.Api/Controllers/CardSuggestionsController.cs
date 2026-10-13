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
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<IEnumerable<CardSuggestion>>> Suggest(CancellationToken cancellationToken)
    {
        if (!suggester.IsAvailable)
        {
            return Problem("Card suggestions aren't available.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .Include(card => card.Tags.OrderBy(tag => tag.Name))
            .OrderBy(card => card.Id)
            .ToListAsync(cancellationToken);

        IReadOnlyList<CardSuggestion> suggested;
        try
        {
            suggested = await suggester.SuggestAsync(
                cards.TakeLast(MaxCardsDescribed).ToList(), SuggestionCount + ExtraRequested, cancellationToken);
        }
        // A timeout surfaces as a cancellation the caller didn't ask for.
        catch (Exception ex) when (ex is HttpRequestException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogError(ex, "Suggesting cards failed");
            return Problem("Card suggestions failed.", statusCode: StatusCodes.Status502BadGateway);
        }

        var suggestions = Usable(suggested, cards).Take(SuggestionCount).ToList();
        logger.LogInformation(
            "Suggested {Count} of {Requested} cards from {CardCount} cards", suggestions.Count, suggested.Count, cards.Count);

        return Ok(suggestions);
    }

    // The suggestions trimmed, leaving out any with a blank or too-long side, and any that would be a duplicate of one
    // of the user's cards or an earlier suggestion (either side matching, ignoring case, as when a card is saved).
    private static IEnumerable<CardSuggestion> Usable(IEnumerable<CardSuggestion> suggested, List<FlashCard> cards)
    {
        var spanish = new HashSet<string>(cards.Select(card => card.Spanish), StringComparer.OrdinalIgnoreCase);
        var english = new HashSet<string>(cards.Select(card => card.English), StringComparer.OrdinalIgnoreCase);

        foreach (var suggestion in suggested)
        {
            // The answer is read from JSON, so a side can be missing despite the type.
            var card = new CardSuggestion(
                (suggestion.Spanish ?? string.Empty).Trim(), (suggestion.English ?? string.Empty).Trim());
            if (!Fits(card.Spanish) || !Fits(card.English)
                || spanish.Contains(card.Spanish) || english.Contains(card.English))
            {
                continue;
            }

            spanish.Add(card.Spanish);
            english.Add(card.English);
            yield return card;
        }
    }

    private static bool Fits(string side)
    {
        return side.Length is > 0 and <= 200;
    }
}
