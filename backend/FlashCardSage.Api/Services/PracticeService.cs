using System.Runtime.ExceptionServices;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// The user's practice: their cards' scores (see FlashCardScoring), the pack the device practices from, and the
/// answers it records (see PracticeController, PracticeResultsController and FlashCardScoresController).
/// </summary>
/// <remarks>
/// Log statements include ids and counts only, never a card's words.
/// </remarks>
public class PracticeService(FlashCardDbContext dbContext, ILogger<PracticeService> logger)
{
    // All the user's cards' scores in card order, or a deck's or a tag's. Null when the deck or tag isn't the user's.
    public async Task<List<FlashCardScore>?> ScoreAsync(PracticeSelection? selection)
    {
        return selection is not null && !await dbContext.SelectionExistsAsync(selection)
            ? null
            : await dbContext.ScoreFlashCardsAsync(selection);
    }

    // All the user's cards with their scores and tags, and their decks and tags, for the device to keep and pick the
    // cards to practice from itself.
    public async Task<PracticePack> GetPackAsync()
    {
        var scores = await dbContext.ScoreFlashCardsAsync(null);

        var links = await dbContext.FlashCards
            .AsNoTracking()
            .SelectMany(card => card.Tags.Select(tag => new { FlashCardId = card.Id, TagId = tag.Id }))
            .OrderBy(link => link.TagId)
            .ToListAsync();
        var tagIdsByCard = links.ToLookup(link => link.FlashCardId, link => link.TagId);

        var decks = await dbContext.Decks
            .AsNoTracking()
            .WithCards()
            .OrderBy(deck => deck.Name)
            .ToListAsync();

        var tags = await dbContext.Tags
            .AsNoTracking()
            .OrderBy(tag => tag.Name)
            .ToListAsync();

        var cards = scores
            .Select(card => new PracticePackCard(
                card.Id,
                card.Spanish,
                card.English,
                card.Score,
                card.LastPracticedAt,
                card.ImageUrl,
                [.. tagIdsByCard[card.Id]]))
            .ToList();

        logger.LogInformation(
            "Packed {CardCount} flash cards, {DeckCount} decks and {TagCount} tags to practice",
            cards.Count,
            decks.Count,
            tags.Count);

        return new PracticePack(cards, [.. decks.Select(DeckResponse.From)], tags);
    }

    // The answers the device kept, oldest first, returning how many were recorded. Each is recorded once, by the id
    // the device gave it, so the device can send them again when it didn't hear back. Answers for cards that are gone
    // (or were never the user's) are skipped rather than refused, since the device can't do anything else with them.
    public async Task<int> RecordResultsAsync(
        IReadOnlyList<(Guid Id, int FlashCardId, PracticeOutcome Outcome, DateTimeOffset PracticedAt)> results,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(results);

        // The unique index refuses an answer that's already recorded too, but looking first spares a failed save for
        // each one sent again (and the in-memory database has no unique indexes).
        var clientIds = results.Select(result => result.Id).Distinct().ToList();
        var recorded = (await dbContext.PracticeResults
                .Where(result => result.ClientId != null && clientIds.Contains(result.ClientId.Value))
                .Select(result => result.ClientId!.Value)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        // Looked up through the query filter, so another user's card is skipped like one that's been deleted.
        var cardIds = results.Select(result => result.FlashCardId).Distinct().ToList();
        var cards = (await dbContext.FlashCards
                .Where(card => cardIds.Contains(card.Id))
                .Select(card => card.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        var now = DateTimeOffset.UtcNow;
        var accepted = 0;
        foreach (var (id, flashCardId, outcome, practicedAt) in results)
        {
            // Adding the id also skips it if it's sent twice in this request.
            if (!cards.Contains(flashCardId) || !recorded.Add(id))
            {
                continue;
            }

            dbContext.PracticeResults.Add(new PracticeResult
            {
                ClientId = id,
                FlashCardId = flashCardId,
                Outcome = outcome,
                // A device's clock can be ahead, and an answer can't have been given later than it was received.
                PracticedAt = practicedAt < now ? practicedAt : now
            });

            // Saved one at a time, so the ids follow the order the answers were given in, which scores go by. One
            // insert of many rows doesn't promise that.
            if (await dbContext.TrySaveUniqueAsync(cancellationToken) is { } failure)
            {
                // Another request recorded the same answer in the meantime (the device sent it again before hearing
                // back), which fails the unique index, or the card was deleted since it was looked up.
                if (await dbContext.PracticeResults.AnyAsync(item => item.ClientId == id, cancellationToken)
                    || !await dbContext.FlashCards.AnyAsync(card => card.Id == flashCardId, cancellationToken))
                {
                    continue;
                }

                ExceptionDispatchInfo.Throw(failure);
            }

            accepted++;
        }

        logger.LogInformation("Synced {Accepted} of {Count} practice results", accepted, results.Count);

        return accepted;
    }

    // How the user answered a card each time they practiced it, newest first. Null when the card isn't the user's.
    public async Task<List<PracticeResult>?> GetHistoryAsync(int cardId)
    {
        // Looked up first, through the query filter, so another user's card is never found.
        return !await dbContext.FlashCards.AnyAsync(card => card.Id == cardId)
            ? null
            : await dbContext.PracticeResults
                .AsNoTracking()
                .Where(result => result.FlashCardId == cardId)
                .OrderByDescending(result => result.Id)
                .ToListAsync();
    }
}
