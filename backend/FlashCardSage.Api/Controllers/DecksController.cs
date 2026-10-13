using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The user's decks, each a named set of their cards to practice. Saving a deck replaces its cards, so adding all
/// the cards with a tag is done by sending their ids.
/// </summary>
/// <remarks>
/// Like FlashCardsController, log statements include ids only, never a deck's name.
/// </remarks>
[ApiController]
[Route("api/decks")]
public class DecksController(FlashCardDbContext dbContext, ILogger<DecksController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<DeckResponse>>> GetAll()
    {
        logger.LogInformation("Retrieving all decks");

        var decks = await dbContext.Decks
            .AsNoTracking()
            .Include(deck => deck.FlashCards)
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
            .Include(item => item.FlashCards)
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
        var decks = await dbContext.Decks.ToListAsync();
        var (name, cards) = await ValidateAsync(request, decks, id: null);
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var deck = new Deck { Name = name, FlashCards = cards };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created deck {DeckId} with {Count} flash cards", deck.Id, cards.Count);

        return CreatedAtAction(nameof(GetById), new { id = deck.Id }, DeckResponse.From(deck));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<DeckResponse>> Update(int id, [FromBody] DeckRequest request)
    {
        var decks = await dbContext.Decks.ToListAsync();
        var deck = decks.FirstOrDefault(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found for update", id);
            return NotFound();
        }

        var (name, cards) = await ValidateAsync(request, decks, id);
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // The deck's current cards are loaded so EF can work out which links to add and remove.
        await dbContext.Entry(deck).Collection(item => item.FlashCards).LoadAsync();
        deck.Name = name;
        deck.FlashCards = cards;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Updated deck {DeckId} with {Count} flash cards", id, cards.Count);

        return Ok(DeckResponse.From(deck));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        // The deck's cards are loaded so EF removes them from the deck first, which the database leaves to it.
        var deck = await dbContext.Decks
            .Include(item => item.FlashCards)
            .FirstOrDefaultAsync(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found for deletion", id);
            return NotFound();
        }

        dbContext.Decks.Remove(deck);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted deck {DeckId}", id);

        return NoContent();
    }

    // Trims the name and finds the cards, adding a model error if the name is blank or another of the user's decks
    // (any but the one with this id) already has it, or if any of the cards isn't one of the user's.
    private async Task<(string Name, List<FlashCard> Cards)> ValidateAsync(
        DeckRequest request, List<Deck> decks, int? id)
    {
        var name = request.Name.Trim();

        if (name.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Name), "Deck name is required.");
        }
        // Names are unique whatever their case, as the database's index is.
        else if (decks.Any(item => item.Id != id && string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase)))
        {
            ModelState.AddModelError(nameof(request.Name), "There's already a deck with that name.");
        }

        // Found through the query filter, so another user's cards can't be put in the deck.
        var cardIds = request.FlashCardIds.Distinct().ToList();
        var cards = await dbContext.FlashCards
            .Where(card => cardIds.Contains(card.Id))
            .ToListAsync();

        if (cards.Count != cardIds.Count)
        {
            ModelState.AddModelError(nameof(request.FlashCardIds), "Some of those flash cards no longer exist.");
        }

        return (name, cards);
    }
}
