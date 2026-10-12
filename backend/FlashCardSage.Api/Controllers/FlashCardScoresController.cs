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
    [HttpGet]
    public async Task<ActionResult<FlashCardScoresResponse>> Get()
    {
        logger.LogInformation("Scoring flash cards");

        var scores = (await dbContext.ScoreFlashCardsAsync())
            .OrderBy(score => score.Score)
            .ThenBy(score => score.Id)
            .ToList();

        logger.LogInformation("Scored {Count} flash cards", scores.Count);

        return Ok(new FlashCardScoresResponse(
            scores.Sum(score => score.Score), scores.Count * PracticeScore.Maximum, scores));
    }
}
