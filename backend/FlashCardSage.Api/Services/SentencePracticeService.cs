using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// The user's answers in Sentences practice mode (see SentencePracticeController), kept to learn from. They don't
/// count toward any card's score.
/// </summary>
/// <remarks>
/// Log statements include counts only, never a sentence's words.
/// </remarks>
public class SentencePracticeService(FlashCardDbContext dbContext, ILogger<SentencePracticeService> logger)
{
    // Records the answer, given now, keeping only the ids of the user's cards. A card that's gone (or was never the
    // user's) is skipped rather than refused, since the device can't do anything else with it.
    public async Task RecordAsync(
        string spanish,
        string english,
        IReadOnlyCollection<int> cardIds,
        Language shownSide,
        PracticeOutcome outcome,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(cardIds);

        // Looked up through the query filter, so another user's card is skipped like one that's been deleted.
        var requested = cardIds.Distinct().ToList();
        var cards = (await dbContext.FlashCards
                .Where(card => requested.Contains(card.Id))
                .Select(card => card.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        dbContext.SentencePracticeResults.Add(new SentencePracticeResult
        {
            Spanish = spanish,
            English = english,
            CardIds = [.. requested.Where(cards.Contains)],
            ShownSide = shownSide,
            Outcome = outcome,
            PracticedAt = DateTimeOffset.UtcNow
        });
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation(
            "Recorded a sentence practice result with {Kept} of {Count} cards", cards.Count, cardIds.Count);
    }
}
