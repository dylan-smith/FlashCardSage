using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <remarks>
/// Log statements use structured logging with typed route parameters (e.g. int id) only.
/// User-provided strings such as card titles are intentionally excluded to prevent log-forging.
/// </remarks>
[ApiController]
[Route("api/flashcards")]
public class FlashCardsController(FlashCardDbContext dbContext, ILogger<FlashCardsController> logger) : ControllerBase
{
    // In the order they were made, so a list of words stays in the order it was typed in.
    [HttpGet]
    public async Task<ActionResult<IEnumerable<FlashCard>>> GetAll()
    {
        logger.LogInformation("Retrieving all flash cards");

        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .OrderBy(card => card.Id)
            .ToListAsync();

        logger.LogInformation("Retrieved {Count} flash cards", cards.Count);

        return Ok(cards);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<FlashCard>> GetById(int id)
    {
        logger.LogInformation("Retrieving flash card {FlashCardId}", id);

        var card = await dbContext.FlashCards
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found", id);
            return NotFound();
        }

        return Ok(card);
    }

    [HttpPost]
    public async Task<ActionResult<FlashCard>> Create([FromBody] FlashCardRequest request)
    {
        var trimmedTitle = request.Title.Trim();

        if (trimmedTitle.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Title), "Title is required.");
            return ValidationProblem(ModelState);
        }

        var card = new FlashCard
        {
            Title = trimmedTitle
        };

        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created flash card {FlashCardId}", card.Id);

        return CreatedAtAction(nameof(GetById), new { id = card.Id }, card);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<FlashCard>> Update(int id, [FromBody] FlashCardRequest request)
    {
        var card = await dbContext.FlashCards.FirstOrDefaultAsync(item => item.Id == id);

        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for update", id);
            return NotFound();
        }

        var trimmedTitle = request.Title.Trim();

        if (trimmedTitle.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Title), "Title is required.");
            return ValidationProblem(ModelState);
        }

        card.Title = trimmedTitle;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Updated flash card {FlashCardId}", id);

        return Ok(card);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var card = await dbContext.FlashCards.FirstOrDefaultAsync(item => item.Id == id);

        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for deletion", id);
            return NotFound();
        }

        dbContext.FlashCards.Remove(card);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted flash card {FlashCardId}", id);

        return NoContent();
    }
}
