using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Picks the card to start practicing with. PracticeResultsController picks each one after that.
/// </summary>
[ApiController]
[Route("api/flashcards/practice")]
public class PracticeController(FlashCardDbContext dbContext, ILogger<PracticeController> logger) : ControllerBase
{
    // No content when there are no cards to practice.
    [HttpGet("next")]
    [ProducesResponseType<PracticeCard>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<ActionResult<PracticeCard>> GetNext()
    {
        var next = await PracticePicker.PickNextAsync(dbContext, previousId: null);
        if (next is null)
        {
            logger.LogInformation("No flash cards to practice");
            return NoContent();
        }

        logger.LogInformation("Picked flash card {FlashCardId} to practice", next.Id);
        return Ok(next);
    }
}
