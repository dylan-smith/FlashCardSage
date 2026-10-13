using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
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
public class FlashCardsController(
    FlashCardDbContext dbContext,
    IImageStore imageStore,
    ILogger<FlashCardsController> logger) : ControllerBase
{
    public const string DuplicateSpanishMessage = "You already have a flash card with this Spanish.";

    public const string DuplicateEnglishMessage = "You already have a flash card with this English.";

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

        if (await FindClashAsync(spanish, english, exceptId: null) is { } clash)
        {
            logger.LogWarning("Refused a duplicate flash card");
            return DuplicateProblem(clash, spanish);
        }

        var card = new FlashCard
        {
            Spanish = spanish,
            English = english,
            Tags = await FindOrMakeTagsAsync(tagNames)
        };

        dbContext.FlashCards.Add(card);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // A card saved since the check above failed a unique index on the Spanish or English.
            dbContext.ChangeTracker.Clear();
            var saved = await FindClashAsync(spanish, english, exceptId: null);

            if (saved is null)
            {
                throw;
            }

            // The same card, so it's this one: EF Core retried an insert whose first try went through (say, while
            // the database resumed from auto-pause), or the same card was sent twice at once.
            if (SameText(saved.Spanish, spanish) && SameText(saved.English, english))
            {
                logger.LogInformation("Flash card {FlashCardId} was already created", saved.Id);
                return CreatedAtAction(nameof(GetById), new { id = saved.Id }, await LoadAsync(saved.Id));
            }

            logger.LogWarning("Refused a duplicate flash card");
            return DuplicateProblem(saved, spanish);
        }

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

        if (await FindClashAsync(spanish, english, exceptId: id) is { } clash)
        {
            logger.LogWarning("Refused to make flash card {FlashCardId} a duplicate", id);
            return DuplicateProblem(clash, spanish);
        }

        var tags = await FindOrMakeTagsAsync(tagNames);
        card.Spanish = spanish;
        card.English = english;
        card.Tags.Clear();
        card.Tags.AddRange(tags);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Another card saved since the check above failed a unique index. A retried update can't do that, since
            // it only writes this card again, so it's always a duplicate.
            dbContext.ChangeTracker.Clear();
            var saved = await FindClashAsync(spanish, english, exceptId: id);

            if (saved is null)
            {
                throw;
            }

            logger.LogWarning("Refused to make flash card {FlashCardId} a duplicate", id);
            return DuplicateProblem(saved, spanish);
        }

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

        // Once the card is gone, so nothing points at the picture, it's removed too.
        if (card.ImageUrl is { } imageUrl)
        {
            await imageStore.TryDeleteAsync(imageUrl, logger, CancellationToken.None);
        }

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

    // Another of the user's cards with this Spanish, or else with this English, ignoring case, or null when neither
    // is taken. A word with more than one translation belongs on one card (e.g. "the bank / the bench"), or the user
    // wouldn't know which answer a card wants, so either side matching is a duplicate. The cards are compared in
    // memory, since the in-memory database used in development can't ignore case in a query.
    private async Task<CardSides?> FindClashAsync(string spanish, string english, int? exceptId)
    {
        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .Where(card => card.Id != exceptId)
            .Select(card => new CardSides(card.Id, card.Spanish, card.English))
            .ToListAsync();

        return cards.FirstOrDefault(card => SameText(card.Spanish, spanish))
            ?? cards.FirstOrDefault(card => SameText(card.English, english));
    }

    // A 409 that says which side of the card is taken.
    private ObjectResult DuplicateProblem(CardSides clash, string spanish)
    {
        var message = SameText(clash.Spanish, spanish) ? DuplicateSpanishMessage : DuplicateEnglishMessage;
        return Problem(detail: message, statusCode: StatusCodes.Status409Conflict);
    }

    private Task<FlashCard> LoadAsync(int id)
    {
        return dbContext.FlashCards
            .AsNoTracking()
            .Include(card => card.Tags.OrderBy(tag => tag.Name))
            .SingleAsync(card => card.Id == id);
    }

    private static bool SameText(string a, string b)
    {
        return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    private sealed record CardSides(int Id, string Spanish, string English);
}
