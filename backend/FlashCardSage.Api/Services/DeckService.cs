using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Makes, renames, changes the cards of and deletes the user's decks (see DecksController). A deck can hold hundreds
/// of cards, so they're added and removed a few at a time rather than given in full with each change.
/// </summary>
/// <remarks>
/// Log statements include ids only, never a deck's name.
/// </remarks>
public class DeckService(FlashCardDbContext dbContext, ILogger<DeckService> logger)
{
    // The user's decks with their cards, by name.
    public Task<List<Deck>> GetAllAsync()
    {
        return dbContext.Decks
            .AsNoTracking()
            .WithCards()
            .OrderBy(deck => deck.Name)
            .ToListAsync();
    }

    // The user's deck with this id, with its cards, or null if they have no such deck.
    public Task<Deck?> GetAsync(int id)
    {
        return dbContext.Decks
            .AsNoTracking()
            .WithCards()
            .FirstOrDefaultAsync(item => item.Id == id);
    }

    // The user's decks by name, each with how many cards it has, counted in SQL rather than by loading the cards.
    public async Task<List<(Deck Deck, int CardCount)>> GetCardCountsAsync()
    {
        var counts = await dbContext.Decks
            .AsNoTracking()
            .OrderBy(deck => deck.Name)
            .Select(deck => new { Deck = deck, CardCount = deck.FlashCards.Count })
            .ToListAsync();

        return [.. counts.Select(item => (item.Deck, item.CardCount))];
    }

    // The user's decks the card with this id is in, by name, without their cards.
    public Task<List<Deck>> GetContainingAsync(int cardId)
    {
        return dbContext.Decks
            .AsNoTracking()
            .Where(deck => deck.FlashCards.Any(item => item.Id == cardId))
            .OrderBy(deck => deck.Name)
            .ToListAsync();
    }

    public async Task<DeckResult> CreateAsync(string name, IReadOnlyCollection<int> cardIds)
    {
        ArgumentNullException.ThrowIfNull(cardIds);

        var errors = new List<KeyValuePair<string, string>>();
        var trimmed = await ValidateNameAsync(name, id: null, errors);
        var cards = await FindCardsAsync(cardIds, "FlashCardIds", errors);
        if (errors.Count > 0)
        {
            return new DeckResult.Invalid(errors);
        }

        var deck = new Deck { Name = trimmed, FlashCards = cards };
        dbContext.Decks.Add(deck);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created deck {DeckId} with {Count} flash cards", deck.Id, cards.Count);

        return new DeckResult.Saved(deck);
    }

    // Renames the deck, leaving its cards as they are.
    public async Task<DeckResult> RenameAsync(int id, string name)
    {
        var deck = await dbContext.Decks
            .WithCards()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found for rename", id);
            return new DeckResult.NotFound();
        }

        var errors = new List<KeyValuePair<string, string>>();
        var trimmed = await ValidateNameAsync(name, id, errors);
        if (errors.Count > 0)
        {
            return new DeckResult.Invalid(errors);
        }

        deck.Name = trimmed;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Renamed deck {DeckId}", id);

        return new DeckResult.Saved(deck);
    }

    // Adds and removes cards, and returns the deck with all its cards.
    public async Task<DeckResult> ChangeCardsAsync(int id, IReadOnlyCollection<int> add, IReadOnlyCollection<int> remove)
    {
        ArgumentNullException.ThrowIfNull(add);
        ArgumentNullException.ThrowIfNull(remove);

        // The deck's cards are loaded so EF can work out which links to add and remove.
        var deck = await dbContext.Decks
            .WithCards()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found to change its cards", id);
            return new DeckResult.NotFound();
        }

        var errors = new List<KeyValuePair<string, string>>();
        var added = await FindCardsAsync(add, "Add", errors);
        if (errors.Count > 0)
        {
            return new DeckResult.Invalid(errors);
        }

        // Removing a card that's gone, or that isn't in the deck, is what the caller wanted already.
        var removed = remove.ToHashSet();
        deck.FlashCards.RemoveAll(card => removed.Contains(card.Id));
        var kept = deck.FlashCards.Select(card => card.Id).ToHashSet();
        deck.FlashCards.AddRange(added.Where(card => !kept.Contains(card.Id) && !removed.Contains(card.Id)));
        await dbContext.SaveChangesAsync();

        logger.LogInformation(
            "Changed deck {DeckId}'s flash cards, adding {AddCount} and removing {RemoveCount}",
            id,
            add.Count,
            remove.Count);

        return new DeckResult.Saved(deck);
    }

    // Deletes the deck, keeping its cards.
    public async Task<DeckResult> DeleteAsync(int id)
    {
        // The deck's cards are loaded so EF removes them from the deck first, which the database leaves to it.
        var deck = await dbContext.Decks
            .WithCards()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found for deletion", id);
            return new DeckResult.NotFound();
        }

        dbContext.Decks.Remove(deck);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted deck {DeckId}", id);

        return new DeckResult.Deleted();
    }

    // Trims the name, adding an error if it's blank or another of the user's decks (any but the one with this id)
    // already has it.
    private async Task<string> ValidateNameAsync(string requested, int? id, List<KeyValuePair<string, string>> errors)
    {
        var name = requested.Trim();

        if (name.Length == 0)
        {
            errors.Add(new("Name", "Deck name is required."));
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
            errors.Add(new("Name", "There's already a deck with that name."));
        }

        return name;
    }

    // The user's cards with these ids, adding an error on the field if any of them isn't one. Found through the query
    // filter, so another user's cards can't be put in a deck.
    private async Task<List<FlashCard>> FindCardsAsync(
        IEnumerable<int> ids, string field, List<KeyValuePair<string, string>> errors)
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
            errors.Add(new(field, "Some of those flash cards no longer exist."));
        }

        return cards;
    }
}
