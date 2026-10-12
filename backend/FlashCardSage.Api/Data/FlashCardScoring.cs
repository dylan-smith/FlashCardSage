using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

public static class FlashCardScoring
{
    // Scores each of the user's cards from how many times in a row it was last answered with Got it! in practice,
    // in card order.
    public static async Task<List<FlashCardScore>> ScoreFlashCardsAsync(this FlashCardDbContext dbContext)
    {
        var cards = await dbContext.FlashCards
            .AsNoTracking()
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
                resultsByCard[card.Id].FirstOrDefault()?.PracticedAt))
            .ToList();
    }
}
