using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Records how the user did each time they practice a card, says how much that changed the card's score, and picks
/// the card to practice next.
/// FlashCardScoresController scores the cards from them.
/// </summary>
[ApiController]
[Route("api/flashcards/{flashCardId:int}/practice-results")]
public class PracticeResultsController(FlashCardDbContext dbContext, ILogger<PracticeResultsController> logger)
    : ControllerBase
{
    [HttpPost]
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

        // A card's score only depends on its last few answers, so those are all it takes to see how much this one
        // changes it.
        var recentOutcomes = await dbContext.PracticeResults
            .Where(result => result.FlashCardId == flashCardId)
            .OrderByDescending(result => result.Id)
            .Take(PracticeScore.MaximumStreak)
            .Select(result => result.Outcome)
            .ToListAsync();
        var scoreChange = PracticeScore.FromOutcomes(recentOutcomes.Prepend(request.Outcome!.Value))
            - PracticeScore.FromOutcomes(recentOutcomes);

        dbContext.PracticeResults.Add(new PracticeResult
        {
            FlashCardId = flashCardId,
            Outcome = request.Outcome!.Value,
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
}
