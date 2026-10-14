using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Makes a deck of cards from words in the user's Preply vocabulary. Preply has no API we can call for the user, so
/// the "Send to FlashCardSage" bookmarklet reads the words on preply.com, signed in as the user, and the import page
/// sends the ones they pick here.
/// </summary>
/// <remarks>
/// Like FlashCardsController, log statements include ids and counts only, never a word.
/// </remarks>
[ApiController]
[Route("api/preply-import")]
public class PreplyImportController(
    FlashCardDbContext dbContext,
    ILogger<PreplyImportController> logger) : ControllerBase
{
    public const string DeckName = "Preply";

    // Far more than anyone's Preply vocabulary has, to keep one request's work bounded.
    public const int MaxWords = 2000;

    public const string NothingToImportMessage = "You already have all of these words.";

    public const string ImportClashMessage = "Your cards changed while the words were being added. Try again.";

    // Adds a card for each word to a new deck, leaving out any word whose Spanish or English is already on one of the
    // user's cards, or on an earlier word here, since a user can't have two cards for a word.
    [HttpPost]
    public async Task<ActionResult<DeckImportResponse>> Import(
        PreplyImportRequest request, CancellationToken cancellationToken)
    {
        var words = request.Words
            .Select(word => (Spanish: word.Spanish?.Trim() ?? string.Empty, English: word.English?.Trim() ?? string.Empty))
            .ToList();

        if (words.Count == 0)
        {
            ModelState.AddModelError(nameof(request.Words), "Pick at least one word.");
        }
        else if (words.Count > MaxWords)
        {
            ModelState.AddModelError(nameof(request.Words), $"At most {MaxWords} words can be added at once.");
        }
        else if (words.Any(word => word.Spanish.Length == 0 || word.English.Length == 0))
        {
            ModelState.AddModelError(nameof(request.Words), "Every word needs its Spanish and English.");
        }
        else if (words.Any(word =>
                     word.Spanish.Length > FlashCard.MaxWordLength || word.English.Length > FlashCard.MaxWordLength))
        {
            ModelState.AddModelError(
                nameof(request.Words), $"Words can be at most {FlashCard.MaxWordLength} characters.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var taken = await DeckImport.TakenWordsAsync(dbContext, cancellationToken);
        var deck = new Deck { Name = await DeckImport.UnusedDeckNameAsync(dbContext, DeckName, cancellationToken) };
        var skipped = 0;

        foreach (var (spanish, english) in words)
        {
            if (taken[Language.Spanish].Contains(spanish) || taken[Language.English].Contains(english))
            {
                skipped++;
                continue;
            }

            taken[Language.Spanish].Add(spanish);
            taken[Language.English].Add(english);

            deck.FlashCards.Add(new FlashCard
            {
                Words =
                [
                    new FlashCardWord { Language = Language.Spanish, Text = spanish, Position = 0 },
                    new FlashCardWord { Language = Language.English, Text = english, Position = 0 }
                ]
            });
        }

        if (deck.FlashCards.Count == 0)
        {
            logger.LogInformation("Nothing to import from Preply's {Count} words", words.Count);
            return Problem(detail: NothingToImportMessage, statusCode: StatusCodes.Status409Conflict);
        }

        dbContext.Decks.Add(deck);

        try
        {
            await dbContext.SaveChangesAsync(CancellationToken.None);
        }
        catch (DbUpdateException)
        {
            // A card or deck saved since the checks above failed a unique index.
            dbContext.ChangeTracker.Clear();
            logger.LogWarning("Refused to import Preply words over cards saved meanwhile");
            return Problem(detail: ImportClashMessage, statusCode: StatusCodes.Status409Conflict);
        }

        logger.LogInformation(
            "Imported Preply words as deck {DeckId} with {Count} flash cards, skipping {SkippedCount}",
            deck.Id,
            deck.FlashCards.Count,
            skipped);

        return CreatedAtAction(
            nameof(DecksController.GetById),
            "Decks",
            new { id = deck.Id },
            new DeckImportResponse(DeckResponse.From(deck), deck.FlashCards.Count, skipped));
    }
}
