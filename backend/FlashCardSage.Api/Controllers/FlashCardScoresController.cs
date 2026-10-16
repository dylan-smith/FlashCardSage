using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Scores each card from how many times in a row it was last answered with Got it! in practice. Anything else,
/// including I was close, starts the run again.
/// </summary>
[ApiController]
[Route("api/flashcards/scores")]
public class FlashCardScoresController(FlashCardDbContext dbContext, ILogger<FlashCardScoresController> logger)
    : ControllerBase
{
    // All the user's cards, or a deck's or a tag's, totalling just those. Not found when the deck or tag isn't the
    // user's.
    [HttpGet]
    [ProducesResponseType<FlashCardScoresResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<FlashCardScoresResponse>> Get([FromQuery] PracticeSelection selection)
    {
        logger.LogInformation("Scoring flash cards");

        if (!await dbContext.SelectionExistsAsync(selection))
        {
            logger.LogWarning("Deck {DeckId} or tag {TagId} not found to score", selection.DeckId, selection.TagId);
            return NotFound();
        }

        var scores = (await dbContext.ScoreFlashCardsAsync(selection))
            .OrderBy(score => score.Score)
            .ThenBy(score => score.Id)
            .ToList();

        logger.LogInformation("Scored {Count} flash cards", scores.Count);

        return Ok(new FlashCardScoresResponse(
            scores.Sum(score => score.Score), scores.Count * PracticeScore.Maximum, scores));
    }
}
