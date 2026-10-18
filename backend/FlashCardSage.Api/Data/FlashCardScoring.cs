using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

public static class FlashCardScoring
{
    // Scores each of the user's cards from how many times in a row it was last answered with Got it! in practice,
    // in card order. A selection limits it to the cards in a deck or with a tag.
    public static async Task<List<FlashCardScore>> ScoreFlashCardsAsync(
        this FlashCardDbContext dbContext, PracticeSelection? selection)
    {
        var query = dbContext.FlashCards.AsNoTracking();
        if (selection?.DeckId is { } deckId)
        {
            query = query.Where(card => card.Decks.Any(deck => deck.Id == deckId));
        }

        if (selection?.TagId is { } tagId)
        {
            query = query.Where(card => card.Tags.Any(tag => tag.Id == tagId));
        }

        var cards = await query
            .WithWords()
            .OrderBy(card => card.Id)
            .ToListAsync();

        // Every result is loaded, newest first. Ids follow the order the answers were given in. That's plenty fast
        // for a person's practice history, and it's far simpler than picking each card's last few in SQL.
        var results = await dbContext.PracticeResults
            .AsNoTracking()
            .OrderByDescending(result => result.Id)
            .Select(result => new { result.FlashCardId, result.Outcome, result.PracticedAt })
            .ToListAsync();
        var resultsByCard = results.ToLookup(result => result.FlashCardId);

        return cards
            .Select(card => new FlashCardScore(
                card.Id,
                card.Spanish,
                card.English,
                PracticeScore.FromOutcomes(resultsByCard[card.Id].Select(result => result.Outcome)),
                resultsByCard[card.Id].FirstOrDefault()?.PracticedAt,
                card.ImageUrl))
            .ToList();
    }

    // Whether the selection's deck or tag is one of the user's. Looked up through the query filters, so another
    // user's deck or tag is never found.
    public static async Task<bool> SelectionExistsAsync(this FlashCardDbContext dbContext, PracticeSelection selection)
    {
        ArgumentNullException.ThrowIfNull(selection);
        return (selection.DeckId is not { } deckId || await dbContext.Decks.AnyAsync(deck => deck.Id == deckId))
            && (selection.TagId is not { } tagId || await dbContext.Tags.AnyAsync(tag => tag.Id == tagId));
    }
}
