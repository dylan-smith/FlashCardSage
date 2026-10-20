using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The user's decks, each a named set of their cards to practice. A deck can hold hundreds of cards, so they're
/// added and removed a few at a time (or all the ones the user picked) rather than sent in full with each change.
/// </summary>
/// <remarks>
/// Like FlashCardsController, log statements include ids only, never a deck's name. The changes are made by
/// DeckService, and this turns what became of them into responses.
/// </remarks>
[ApiController]
[Route("api/decks")]
public class DecksController(FlashCardDbContext dbContext, DeckService deckService, ILogger<DecksController> logger)
    : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<DeckResponse>>> GetAll()
    {
        logger.LogInformation("Retrieving all decks");

        var decks = await dbContext.Decks
            .AsNoTracking()
            .WithCards()
            .OrderBy(deck => deck.Name)
            .ToListAsync();

        logger.LogInformation("Retrieved {Count} decks", decks.Count);

        return Ok(decks.Select(DeckResponse.From).ToList());
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<DeckResponse>> GetById(int id)
    {
        logger.LogInformation("Retrieving deck {DeckId}", id);

        var deck = await dbContext.Decks
            .AsNoTracking()
            .WithCards()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found", id);
            return NotFound();
        }

        return Ok(DeckResponse.From(deck));
    }

    [HttpPost]
    public async Task<ActionResult<DeckResponse>> Create([FromBody] DeckRequest request)
    {
        return ToResponse(await deckService.CreateAsync(request.Name, request.FlashCardIds), created: true);
    }

    // Renames the deck, leaving its cards as they are.
    [HttpPut("{id:int}")]
    public async Task<ActionResult<DeckResponse>> Rename(int id, [FromBody] DeckNameRequest request)
    {
        return ToResponse(await deckService.RenameAsync(id, request.Name));
    }

    // Adds and removes cards, and returns the deck with all its cards.
    [HttpPatch("{id:int}/cards")]
    public async Task<ActionResult<DeckResponse>> ChangeCards(int id, [FromBody] DeckCardsRequest request)
    {
        return ToResponse(await deckService.ChangeCardsAsync(id, request.Add, request.Remove));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        return ToResponse(await deckService.DeleteAsync(id));
    }

    // The response for what became of a change, a 201 for a saved deck that's new.
    private ActionResult ToResponse(DeckResult result, bool created = false)
    {
        switch (result)
        {
            case DeckResult.Saved(var deck):
                return created
                    ? CreatedAtAction(nameof(GetById), new { id = deck.Id }, DeckResponse.From(deck))
                    : Ok(DeckResponse.From(deck));
            case DeckResult.Deleted:
                return NoContent();
            case DeckResult.NotFound:
                return NotFound();
            case DeckResult.Invalid(var errors):
                foreach (var (field, message) in errors)
                {
                    ModelState.AddModelError(field, message);
                }

                return ValidationProblem(ModelState);
            default:
                throw new InvalidOperationException($"Unexpected deck result {result.GetType().Name}.");
        }
    }
}
