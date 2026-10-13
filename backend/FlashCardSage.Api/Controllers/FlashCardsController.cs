using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <remarks>
/// Log statements use structured logging with typed route parameters (e.g. int id) only.
/// User-provided strings such as a card's words or tags are intentionally excluded to prevent log-forging.
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
            .Include(card => card.Tags.OrderBy(tag => tag.Name))
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
            .Include(item => item.Tags.OrderBy(tag => tag.Name))
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
        if (!TryTrim(request, out var spanish, out var english, out var tagNames))
        {
            return ValidationProblem(ModelState);
        }

        var card = new FlashCard
        {
            Spanish = spanish,
            English = english,
            Tags = await FindOrMakeTagsAsync(tagNames)
        };

        dbContext.FlashCards.Add(card);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created flash card {FlashCardId}", card.Id);

        return CreatedAtAction(nameof(GetById), new { id = card.Id }, card);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<FlashCard>> Update(int id, [FromBody] FlashCardRequest request)
    {
        var card = await dbContext.FlashCards
            .Include(item => item.Tags)
            .FirstOrDefaultAsync(item => item.Id == id);

        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for update", id);
            return NotFound();
        }

        if (!TryTrim(request, out var spanish, out var english, out var tagNames))
        {
            return ValidationProblem(ModelState);
        }

        var tags = await FindOrMakeTagsAsync(tagNames);
        card.Spanish = spanish;
        card.English = english;
        card.Tags.Clear();
        card.Tags.AddRange(tags);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Updated flash card {FlashCardId}", id);

        return Ok(card);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        // The tags are loaded so EF removes the card's links to them, as the database would.
        var card = await dbContext.FlashCards
            .Include(item => item.Tags)
            .FirstOrDefaultAsync(item => item.Id == id);

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

    // Trims both sides of the card, adding a model error for each one that's left blank. The tag names are trimmed
    // too, leaving out blanks and repeats, with a model error if one is too long.
    private bool TryTrim(
        FlashCardRequest request, out string spanish, out string english, out List<string> tagNames)
    {
        spanish = request.Spanish.Trim();
        english = request.English.Trim();
        tagNames = request.Tags
            .Select(name => (name ?? string.Empty).Trim())
            .Where(name => name.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (spanish.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Spanish), "Spanish is required.");
        }

        if (english.Length == 0)
        {
            ModelState.AddModelError(nameof(request.English), "English is required.");
        }

        if (tagNames.Any(name => name.Length > Tag.MaxNameLength))
        {
            ModelState.AddModelError(nameof(request.Tags), $"Tags can be at most {Tag.MaxNameLength} characters.");
        }

        return ModelState.IsValid;
    }

    // The user's tags with these names, in name order, with a new tag for each name they don't have yet. Names match
    // whatever their case, as they do in the database, so "food" goes on the user's "Food" tag.
    private async Task<List<Tag>> FindOrMakeTagsAsync(List<string> names)
    {
        if (names.Count == 0)
        {
            return [];
        }

        // A person's tags are few, so they're matched here rather than in SQL.
        var existing = await dbContext.Tags.ToListAsync();

        return names
            .Select(name => existing.FirstOrDefault(tag => string.Equals(tag.Name, name, StringComparison.OrdinalIgnoreCase))
                ?? new Tag { Name = name })
            .OrderBy(tag => tag.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
