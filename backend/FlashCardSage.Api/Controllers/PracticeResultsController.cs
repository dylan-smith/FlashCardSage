using System.Runtime.ExceptionServices;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Records the answers the device kept while practicing on its own (offline too), all at once.
/// FlashCardScoresController scores the cards from them.
/// </summary>
[ApiController]
[Route("api/flashcards/practice-results")]
public class PracticeResultsController(FlashCardDbContext dbContext, ILogger<PracticeResultsController> logger)
    : ControllerBase
{
    // The answers the device kept, oldest first. Each is recorded once, by the id the device gave it, so the device
    // can send them again when it didn't hear back. Answers for cards that are gone (or were never the user's) are
    // skipped rather than refused, since the device can't do anything else with them.
    [HttpPost]
    public async Task<ActionResult<PracticeResultsSyncResponse>> Sync(
        [FromBody] PracticeResultsSyncRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Every property is required, so the model binder has already refused a request without one.
        var results = request.Results
            .Select(item => (
                Id: item.Id!.Value,
                FlashCardId: item.FlashCardId!.Value,
                Outcome: item.Outcome!.Value,
                PracticedAt: item.PracticedAt!.Value))
            .ToList();

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

        return Ok(new PracticeResultsSyncResponse(accepted));
    }
}
