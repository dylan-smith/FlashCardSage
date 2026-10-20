using System.Runtime.ExceptionServices;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Records how the user did each time they practice a card, says how much that changed the card's score, and picks
/// the card to practice next. Or records the answers the device kept while practicing on its own (offline too), all
/// at once.
/// FlashCardScoresController scores the cards from them.
/// </summary>
[ApiController]
[Route("api/flashcards")]
public class PracticeResultsController(FlashCardDbContext dbContext, ILogger<PracticeResultsController> logger)
    : ControllerBase
{
    [HttpPost("{flashCardId:int}/practice-results")]
    public async Task<ActionResult<PracticeResultResponse>> Create(
        int flashCardId, [FromBody] PracticeResultRequest request, [FromQuery] PracticeSelection selection)
    {
        // The card is looked up first, since that's what limits it to the current user's cards.
        if (!await dbContext.FlashCards.AnyAsync(card => card.Id == flashCardId))
        {
            logger.LogWarning("Flash card {FlashCardId} not found for a practice result", flashCardId);
            return NotFound();
        }

        if (!await dbContext.SelectionExistsAsync(selection))
        {
            logger.LogWarning(
                "Deck {DeckId} or tag {TagId} not found to practice", selection.DeckId, selection.TagId);
            return NotFound();
        }

        // Required, so the model binder has already refused a request without it.
        var outcome = request.Outcome!.Value;

        // A card's score only depends on its last few answers, so those are all it takes to see how much this one
        // changes it.
        var recentOutcomes = await dbContext.PracticeResults
            .Where(result => result.FlashCardId == flashCardId)
            .OrderByDescending(result => result.Id)
            .Take(PracticeScore.MaximumStreak)
            .Select(result => result.Outcome)
            .ToListAsync();
        var scoreChange = PracticeScore.FromOutcomes(recentOutcomes.Prepend(outcome))
            - PracticeScore.FromOutcomes(recentOutcomes);

        dbContext.PracticeResults.Add(new PracticeResult
        {
            FlashCardId = flashCardId,
            Outcome = outcome,
            PracticedAt = DateTimeOffset.UtcNow
        });
        await dbContext.SaveChangesAsync();

        // Picked after saving, so the answer just given counts, from the same deck or tag. There's none when the deck
        // or tag has lost all its cards since practice started.
        var next = await PracticePicker.PickNextAsync(dbContext, flashCardId, selection);

        logger.LogInformation(
            "Recorded practice result {Outcome} ({ScoreChange}) for flash card {FlashCardId}, next is {NextFlashCardId}",
            request.Outcome,
            scoreChange,
            flashCardId,
            next?.Id);

        return Ok(new PracticeResultResponse(next, scoreChange));
    }

    // The answers the device kept, oldest first. Each is recorded once, by the id the device gave it, so the device
    // can send them again when it didn't hear back. Answers for cards that are gone (or were never the user's) are
    // skipped rather than refused, since the device can't do anything else with them.
    [HttpPost("practice-results")]
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
