using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The built-in decks any user can import (see SystemDeckSeeder). SystemDeckImporter copies them into the user's own,
/// and this turns what became of that into responses.
/// </summary>
/// <remarks>
/// Like FlashCardsController, log statements include ids only, never a name.
/// </remarks>
[ApiController]
[Route("api/system-decks")]
public class SystemDecksController(
    SystemDeckImporter importer,
    ILogger<SystemDecksController> logger) : ApiControllerBase
{
    public const string NothingToImportMessage = "You already have all of these cards.";

    public const string ImportClashMessage = "Your cards changed while the deck was being added. Try again.";

    public const string CardTakenMessage = "You already have this card.";

    public const string CardImportClashMessage = "Your cards changed while the card was being added. Try again.";

    [HttpGet]
    public async Task<ActionResult<IEnumerable<SystemDeckResponse>>> GetAll()
    {
        logger.LogInformation("Retrieving all system decks");

        var decks = await importer.GetAllAsync();

        logger.LogInformation("Retrieved {Count} system decks", decks.Count);

        return Ok(decks);
    }

    // Copies the deck into the user's decks, leaving out any card whose words they already have.
    [HttpPost("{id:int}/import")]
    public async Task<ActionResult<SystemDeckImportResponse>> Import(int id, CancellationToken cancellationToken)
    {
        return await importer.ImportDeckAsync(id, cancellationToken) switch
        {
            SystemDeckImportResult.DeckImported(var deck, var skippedCount) => CreatedAtAction(
                nameof(DecksController.GetById),
                "Decks",
                new { id = deck.Id },
                new SystemDeckImportResponse(DeckResponse.From(deck), deck.FlashCards.Count, skippedCount)),
            SystemDeckImportResult.NotFound => NotFound(),
            SystemDeckImportResult.NothingToImport => ConflictProblem(NothingToImportMessage),
            SystemDeckImportResult.Clash => ConflictProblem(ImportClashMessage),
            var result => throw new InvalidOperationException($"Unexpected import result {result.GetType().Name}.")
        };
    }

    // Copies one of the deck's cards into the user's deck with the built-in deck's name, making that deck if needed.
    [HttpPost("{id:int}/cards/{cardId:int}/import")]
    public async Task<ActionResult<SystemDeckCardImportResponse>> ImportCard(
        int id, int cardId, CancellationToken cancellationToken)
    {
        return await importer.ImportCardAsync(id, cardId, cancellationToken) switch
        {
            SystemDeckImportResult.CardImported(var deck, var deckCreated, var card) => CreatedAtAction(
                nameof(FlashCardsController.GetById),
                "FlashCards",
                new { id = card.Id },
                new SystemDeckCardImportResponse(DeckResponse.From(deck), deckCreated, card)),
            SystemDeckImportResult.NotFound => NotFound(),
            SystemDeckImportResult.CardTaken => ConflictProblem(CardTakenMessage),
            SystemDeckImportResult.Clash => ConflictProblem(CardImportClashMessage),
            var result => throw new InvalidOperationException($"Unexpected import result {result.GetType().Name}.")
        };
    }
}
