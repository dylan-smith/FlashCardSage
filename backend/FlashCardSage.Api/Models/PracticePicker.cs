using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;

namespace FlashCardSage.Api.Models;

// Picks the card to practice next, favouring the cards the user knows least.
public static class PracticePicker
{
    private static readonly TimeSpan Day = TimeSpan.FromDays(1);

    // How likely a card is to come up, up to the maximum score for a card never practiced. The lower its score, the
    // likelier it is, and it gains one for every day since it was last practiced, so even a card with the maximum
    // score comes back now and then.
    public static double Weight(FlashCardScore card, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(card);
        var days = card.LastPracticedAt is { } practicedAt ? Math.Max(0, (now - practicedAt) / Day) : 0;
        return Math.Min(PracticeScore.Maximum, PracticeScore.Maximum - card.Score + days);
    }

    // Picks a card by its weight, and the side shown first, from two rolls between 0 and 1. The card just practiced
    // isn't picked again straight away, unless it's the only one. When every card has no weight, they're all as
    // likely as each other. Null when there are no cards.
    public static PracticeCard? Pick(
        IReadOnlyList<FlashCardScore> cards, int? previousId, DateTimeOffset now, double cardRoll, double sideRoll)
    {
        ArgumentNullException.ThrowIfNull(cards);
        var choices = cards.Count > 1 ? cards.Where(card => card.Id != previousId).ToList() : [.. cards];
        if (choices.Count == 0)
        {
            return null;
        }

        var weights = choices.Select(card => Weight(card, now)).ToList();
        var chances = weights.Sum() > 0 ? weights : [.. choices.Select(_ => 1.0)];
        var target = cardRoll * chances.Sum();
        // Falls back to the last card that can be picked, in case rounding leaves the target past the end.
        var index = chances.FindLastIndex(chance => chance > 0);
        for (var position = 0; position < chances.Count; position++)
        {
            target -= chances[position];
            if (target < 0)
            {
                index = position;
                break;
            }
        }

        var card = choices[index];
        return new PracticeCard(
            card.Id,
            card.Spanish,
            card.English,
            sideRoll < 0.5 ? PracticeSide.Spanish : PracticeSide.English,
            card.ImageUrl);
    }

    // Picks the next of the current user's cards to practice, at random by weight.
    public static async Task<PracticeCard?> PickNextAsync(FlashCardDbContext dbContext, int? previousId)
    {
        var cards = await dbContext.ScoreFlashCardsAsync();
        return Pick(cards, previousId, DateTimeOffset.UtcNow, Random.Shared.NextDouble(), Random.Shared.NextDouble());
    }
}
