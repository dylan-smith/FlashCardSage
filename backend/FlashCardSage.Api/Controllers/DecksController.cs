using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The user's decks, each a named set of their cards to practice. A deck can hold hundreds of cards, so they're
/// added and removed a few at a time (or all the ones the user picked) rather than sent in full with each change.
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
        var name = await ValidateNameAsync(request.Name, id: null);
        var cards = await FindCardsAsync(request.FlashCardIds, nameof(request.FlashCardIds));
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

    // Renames the deck, leaving its cards as they are.
    [HttpPut("{id:int}")]
    public async Task<ActionResult<DeckResponse>> Rename(int id, [FromBody] DeckNameRequest request)
    {
        var deck = await dbContext.Decks
            .WithCards()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found for rename", id);
            return NotFound();
        }

        var name = await ValidateNameAsync(request.Name, id);
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        deck.Name = name;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Renamed deck {DeckId}", id);

        return Ok(DeckResponse.From(deck));
    }

    // Adds and removes cards, and returns the deck with all its cards.
    [HttpPatch("{id:int}/cards")]
    public async Task<ActionResult<DeckResponse>> ChangeCards(int id, [FromBody] DeckCardsRequest request)
    {
        // The deck's cards are loaded so EF can work out which links to add and remove.
        var deck = await dbContext.Decks
            .WithCards()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found to change its cards", id);
            return NotFound();
        }

        var added = await FindCardsAsync(request.Add, nameof(request.Add));
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // Removing a card that's gone, or that isn't in the deck, is what the caller wanted already.
        var removed = request.Remove.ToHashSet();
        deck.FlashCards.RemoveAll(card => removed.Contains(card.Id));
        var kept = deck.FlashCards.Select(card => card.Id).ToHashSet();
        deck.FlashCards.AddRange(added.Where(card => !kept.Contains(card.Id) && !removed.Contains(card.Id)));
        await dbContext.SaveChangesAsync();

        logger.LogInformation(
            "Changed deck {DeckId}'s flash cards, adding {AddCount} and removing {RemoveCount}",
            id,
            request.Add.Count,
            request.Remove.Count);

        return Ok(DeckResponse.From(deck));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        // The deck's cards are loaded so EF removes them from the deck first, which the database leaves to it.
        var deck = await dbContext.Decks
            .WithCards()
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

    // Trims the name, adding a model error if it's blank or another of the user's decks (any but the one with this
    // id) already has it.
    private async Task<string> ValidateNameAsync(string requested, int? id)
    {
        var name = requested.Trim();

        if (name.Length == 0)
        {
            ModelState.AddModelError("Name", "Deck name is required.");
            return name;
        }

        // Names are unique whatever their case, as the database's index is. A person's decks are few, so they're
        // matched here rather than in SQL.
        var names = await dbContext.Decks
            .Where(deck => deck.Id != id)
            .Select(deck => deck.Name)
            .ToListAsync();
        if (names.Any(item => TextRules.SameText(item, name)))
        {
            ModelState.AddModelError("Name", "There's already a deck with that name.");
        }

        return name;
    }

    // The user's cards with these ids, adding a model error on the field if any of them isn't one. Found through the
    // query filter, so another user's cards can't be put in a deck.
    private async Task<List<FlashCard>> FindCardsAsync(List<int> ids, string field)
    {
        var cardIds = ids.Distinct().ToList();
        if (cardIds.Count == 0)
        {
            return [];
        }

        var cards = await dbContext.FlashCards
            .Where(card => cardIds.Contains(card.Id))
            .ToListAsync();

        if (cards.Count != cardIds.Count)
        {
            ModelState.AddModelError(field, "Some of those flash cards no longer exist.");
        }

        return cards;
    }
}
