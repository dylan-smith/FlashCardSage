using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <remarks>
/// Log statements use structured logging with typed route parameters (e.g. int id) only.
/// User-provided strings such as a card's words are intentionally excluded to prevent log-forging.
/// </remarks>
[ApiController]
[Route("api/flashcards")]
public class FlashCardsController(FlashCardDbContext dbContext, ILogger<FlashCardsController> logger) : ControllerBase
{
    public const string DuplicateMessage = "You already have this flash card.";

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
        if (!TryTrim(request, out var spanish, out var english))
        {
            return ValidationProblem(ModelState);
        }

        if (await IsDuplicateAsync(spanish, english, exceptId: null))
        {
            logger.LogWarning("Refused a duplicate flash card");
            return DuplicateProblem();
        }

        var card = new FlashCard
        {
            Spanish = spanish,
            English = english
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

        if (!TryTrim(request, out var spanish, out var english))
        {
            return ValidationProblem(ModelState);
        }

        if (await IsDuplicateAsync(spanish, english, exceptId: id))
        {
            logger.LogWarning("Refused to make flash card {FlashCardId} a duplicate", id);
            return DuplicateProblem();
        }

        card.Spanish = spanish;
        card.English = english;
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

    // Trims both sides of the card, adding a model error for each one that's left blank.
    private bool TryTrim(FlashCardRequest request, out string spanish, out string english)
    {
        spanish = request.Spanish.Trim();
        english = request.English.Trim();

        if (spanish.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Spanish), "Spanish is required.");
        }

        if (english.Length == 0)
        {
            ModelState.AddModelError(nameof(request.English), "English is required.");
        }

        return spanish.Length > 0 && english.Length > 0;
    }

    // Whether the user already has a card with both of these sides, ignoring case, other than the one being changed.
    // A word can have more than one translation, so it's only a duplicate when both sides match. The cards are
    // compared in memory, since the in-memory database used in development can't ignore case in a query.
    private async Task<bool> IsDuplicateAsync(string spanish, string english, int? exceptId)
    {
        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .Where(card => card.Id != exceptId)
            .Select(card => new { card.Spanish, card.English })
            .ToListAsync();

        return cards.Any(card =>
            string.Equals(card.Spanish, spanish, StringComparison.OrdinalIgnoreCase)
            && string.Equals(card.English, english, StringComparison.OrdinalIgnoreCase));
    }

    private ObjectResult DuplicateProblem()
    {
        return Problem(detail: DuplicateMessage, statusCode: StatusCodes.Status409Conflict);
    }
}
