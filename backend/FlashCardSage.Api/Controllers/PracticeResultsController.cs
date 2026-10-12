using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Records how the user did each time they practice a card. Nothing reads the results back yet.
/// </summary>
[ApiController]
[Route("api/flashcards/{flashCardId:int}/practice-results")]
public class PracticeResultsController(FlashCardDbContext dbContext, ILogger<PracticeResultsController> logger)
    : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Create(int flashCardId, [FromBody] PracticeResultRequest request)
    {
        // The card is looked up first, since that's what limits it to the current user's cards.
        if (!await dbContext.FlashCards.AnyAsync(card => card.Id == flashCardId))
        {
            logger.LogWarning("Flash card {FlashCardId} not found for a practice result", flashCardId);
            return NotFound();
        }

        dbContext.PracticeResults.Add(new PracticeResult
        {
            FlashCardId = flashCardId,
            Outcome = request.Outcome!.Value,
            PracticedAt = DateTimeOffset.UtcNow
        });
        await dbContext.SaveChangesAsync();

        logger.LogInformation(
            "Recorded practice result {Outcome} for flash card {FlashCardId}", request.Outcome, flashCardId);

        return NoContent();
    }
}
