using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Sends everything it takes to practice on the device (offline too) in one pack, for the device to pick the cards
/// from itself. PracticeResultsController records the answers the device kept.
/// </summary>
[ApiController]
[Route("api/flashcards/practice")]
public class PracticeController(PracticeService practiceService) : ControllerBase
{
    // All the user's cards with their scores and tags, and their decks and tags, for the device to keep and pick the
    // cards to practice from itself.
    [HttpGet("pack")]
    public async Task<ActionResult<PracticePack>> GetPack()
    {
        return Ok(await practiceService.GetPackAsync());
    }
}
