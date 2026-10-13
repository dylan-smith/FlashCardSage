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
    // From all the user's cards, or a deck's or a tag's. No content when there are no cards to practice, and not
    // found when the deck or tag isn't the user's.
    [HttpGet("next")]
    [ProducesResponseType<PracticeCard>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PracticeCard>> GetNext([FromQuery] PracticeSelection selection)
    {
        if (!await dbContext.SelectionExistsAsync(selection))
        {
            logger.LogWarning(
                "Deck {DeckId} or tag {TagId} not found to practice", selection.DeckId, selection.TagId);
            return NotFound();
        }

        var next = await PracticePicker.PickNextAsync(dbContext, previousId: null, selection);
        if (next is null)
        {
            logger.LogInformation("No flash cards to practice");
            return NoContent();
        }

        logger.LogInformation("Picked flash card {FlashCardId} to practice", next.Id);
        return Ok(next);
    }
}
