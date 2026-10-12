using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

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

        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .OrderBy(card => card.Id)
            .ToListAsync();

        // Every result is loaded, newest first. Ids follow the order the answers were given in. That's plenty fast
        // for a person's practice history, and it's far simpler than picking each card's last few in SQL.
        var results = await dbContext.PracticeResults
            .AsNoTracking()
            .OrderByDescending(result => result.Id)
            .Select(result => new { result.FlashCardId, result.Outcome, result.PracticedAt })
            .ToListAsync();
        var resultsByCard = results.ToLookup(result => result.FlashCardId);

        var scores = cards
            .Select(card => new FlashCardScore(
                card.Id,
                card.Spanish,
                card.English,
                PracticeScore.FromOutcomes(resultsByCard[card.Id].Select(result => result.Outcome)),
                resultsByCard[card.Id].FirstOrDefault()?.PracticedAt))
            .OrderBy(score => score.Score)
            .ThenBy(score => score.Id)
            .ToList();

        logger.LogInformation("Scored {Count} flash cards", scores.Count);

        return Ok(new FlashCardScoresResponse(
            scores.Sum(score => score.Score), scores.Count * PracticeScore.Maximum, scores));
    }
}
