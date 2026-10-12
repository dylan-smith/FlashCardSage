using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Records how the user did each time they practice a card. FlashCardScoresController scores the cards from them,
/// and each answer returns the card's new score, so practice mode can keep picking cards by score.
/// </summary>
[ApiController]
[Route("api/flashcards/{flashCardId:int}/practice-results")]
public class PracticeResultsController(FlashCardDbContext dbContext, ILogger<PracticeResultsController> logger)
    : ControllerBase
{
    [HttpPost]
    public async Task<ActionResult<PracticeResultResponse>> Create(
        int flashCardId, [FromBody] PracticeResultRequest request)
    {
        // The card is looked up first, since that's what limits it to the current user's cards.
        if (!await dbContext.FlashCards.AnyAsync(card => card.Id == flashCardId))
        {
            logger.LogWarning("Flash card {FlashCardId} not found for a practice result", flashCardId);
            return NotFound();
        }

        var result = new PracticeResult
        {
            FlashCardId = flashCardId,
            Outcome = request.Outcome!.Value,
            PracticedAt = DateTimeOffset.UtcNow
        };
        dbContext.PracticeResults.Add(result);
        await dbContext.SaveChangesAsync();

        // Only the latest few results can count towards the score. Ids follow the order the answers were given in.
        var latestOutcomes = await dbContext.PracticeResults
            .AsNoTracking()
            .Where(item => item.FlashCardId == flashCardId)
            .OrderByDescending(item => item.Id)
            .Take(PracticeScore.MaximumStreak)
            .Select(item => item.Outcome)
            .ToListAsync();
        var score = PracticeScore.FromOutcomes(latestOutcomes);

        logger.LogInformation(
            "Recorded practice result {Outcome} for flash card {FlashCardId}, now scored {Score}",
            request.Outcome,
            flashCardId,
            score);

        return Ok(new PracticeResultResponse(score, result.PracticedAt));
    }
}
