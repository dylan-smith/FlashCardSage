using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
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
    // The 409 for a word that's already on another of the user's cards. A word with more than one translation
    // belongs on one card, so the user is pointed at that card.
    public static string DuplicateMessage(Language language, string word)
    {
        return $"You already have a flash card with the {language} \"{word}\". Add this translation to that card instead.";
    }

    // In the order they were made, so a list of words stays in the order it was typed in.
    [HttpGet]
    public async Task<ActionResult<IEnumerable<FlashCard>>> GetAll()
    {
        logger.LogInformation("Retrieving all flash cards");

        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .Include(card => card.Words)
            .Include(card => card.Tags.OrderBy(tag => tag.Name))
            .OrderBy(card => card.Id)
            .AsSplitQuery()
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
            .Include(item => item.Words)
            .Include(item => item.Tags.OrderBy(tag => tag.Name))
            .AsSplitQuery()
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
            return DuplicateProblem(clash);
        }

        var card = new FlashCard { Tags = await FindOrMakeTagsAsync(tagNames) };
        SetWords(card, Language.Spanish, spanish);
        SetWords(card, Language.English, english);

        dbContext.FlashCards.Add(card);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // A card saved since the check above failed the unique index on its words.
            dbContext.ChangeTracker.Clear();
            var saved = await FindClashAsync(spanish, english, exceptId: null);

            if (saved is null)
            {
                throw;
            }

            // The same card, so it's this one: EF Core retried an insert whose first try went through (say, while
            // the database resumed from auto-pause), or the same card was sent twice at once.
            var savedCard = await LoadAsync(saved.FlashCardId);
            if (SameWords(savedCard.Spanish, spanish) && SameWords(savedCard.English, english))
            {
                logger.LogInformation("Flash card {FlashCardId} was already created", savedCard.Id);
                return CreatedAtAction(nameof(GetById), new { id = savedCard.Id }, savedCard);
            }

            logger.LogWarning("Refused a duplicate flash card");
            return DuplicateProblem(saved);
        }

        logger.LogInformation("Created flash card {FlashCardId}", card.Id);

        return CreatedAtAction(nameof(GetById), new { id = card.Id }, card);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<FlashCard>> Update(int id, [FromBody] FlashCardRequest request)
    {
        var card = await dbContext.FlashCards
            .Include(item => item.Words)
            .Include(item => item.Tags)
            .AsSplitQuery()
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
            return DuplicateProblem(clash);
        }

        var tags = await FindOrMakeTagsAsync(tagNames);
        SetWords(card, Language.Spanish, spanish);
        SetWords(card, Language.English, english);
        card.Tags.Clear();
        card.Tags.AddRange(tags);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // Another card saved since the check above failed the unique index. A retried update can't do that,
            // since it only writes this card's words again, so it's always a duplicate.
            dbContext.ChangeTracker.Clear();
            var saved = await FindClashAsync(spanish, english, exceptId: id);

            if (saved is null)
            {
                throw;
            }

            logger.LogWarning("Refused to make flash card {FlashCardId} a duplicate", id);
            return DuplicateProblem(saved);
        }

        logger.LogInformation("Updated flash card {FlashCardId}", id);

        return Ok(card);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        // The words and tags are loaded so EF removes them and the card's links to the tags, as the database would.
        // The in-memory database used in development only cascades to what's loaded, and would keep the words.
        var card = await dbContext.FlashCards
            .Include(item => item.Words)
            .Include(item => item.Tags)
            .AsSplitQuery()
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

    // Deletes many cards at once, such as all the ones picked on the cards page. A card that's already gone is what
    // the caller wanted, and another user's is never found through the query filter, so both are skipped.
    [HttpPost("delete")]
    public async Task<IActionResult> DeleteMany([FromBody] FlashCardIdsRequest request)
    {
        var ids = request.FlashCardIds.Distinct().ToList();

        // Loaded with their words and tags for the same reason as in Delete.
        var cards = ids.Count == 0
            ? []
            : await dbContext.FlashCards
                .Include(item => item.Words)
                .Include(item => item.Tags)
                .Where(item => ids.Contains(item.Id))
                .AsSplitQuery()
                .ToListAsync();

        dbContext.FlashCards.RemoveRange(cards);
        await dbContext.SaveChangesAsync();

        foreach (var imageUrl in cards.Select(card => card.ImageUrl).OfType<string>())
        {
            await imageStore.TryDeleteAsync(imageUrl, logger, CancellationToken.None);
        }

        logger.LogInformation("Deleted {Count} flash cards", cards.Count);

        return NoContent();
    }

    // Trims each side's words, leaving out blanks and repeats (ignoring case), and adds a model error for a side
    // that's left with none, too many or one that's too long. The tag names are trimmed the same way, with a model
    // error if one is too long.
    private bool TryTrim(
        FlashCardRequest request, out List<string> spanish, out List<string> english, out List<string> tagNames)
    {
        spanish = TrimWords(request.Spanish);
        english = TrimWords(request.English);
        tagNames = TrimWords(request.Tags);

        CheckWords(nameof(request.Spanish), Language.Spanish, spanish);
        CheckWords(nameof(request.English), Language.English, english);

        if (tagNames.Any(name => name.Length > Tag.MaxNameLength))
        {
            ModelState.AddModelError(nameof(request.Tags), $"Tags can be at most {Tag.MaxNameLength} characters.");
        }

        return ModelState.IsValid;
    }

    private void CheckWords(string field, Language language, List<string> words)
    {
        if (words.Count == 0)
        {
            ModelState.AddModelError(field, $"{language} is required.");
        }
        else if (words.Count > FlashCard.MaxWordsPerSide)
        {
            ModelState.AddModelError(
                field, $"A flash card can have at most {FlashCard.MaxWordsPerSide} {language} translations.");
        }
        else if (words.Any(word => word.Length > FlashCard.MaxWordLength))
        {
            ModelState.AddModelError(field, $"{language} can be at most {FlashCard.MaxWordLength} characters.");
        }
    }

    private static List<string> TrimWords(List<string> words)
    {
        return words
            .Select(word => (word ?? string.Empty).Trim())
            .Where(word => word.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    // Makes the card's words in a language these, in this order. A word the card already has (whatever its case) is
    // kept and moved, so the database never sees it removed and added again, which the unique index could refuse.
    private static void SetWords(FlashCard card, Language language, List<string> texts)
    {
        var existing = card.Words.Where(word => word.Language == language).ToList();
        card.Words.RemoveAll(word =>
            word.Language == language && !texts.Any(text => SameText(text, word.Text)));

        for (var position = 0; position < texts.Count; position++)
        {
            var word = existing.FirstOrDefault(item => SameText(item.Text, texts[position]));
            if (word is null)
            {
                card.Words.Add(new FlashCardWord { Language = language, Text = texts[position], Position = position });
            }
            else
            {
                word.Text = texts[position];
                word.Position = position;
            }
        }
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

    // A word on another of the user's cards that's one of these Spanish words, or else one of these English ones,
    // ignoring case, or null when none is taken. A word with more than one translation belongs on one card (e.g.
    // "solo" and "únicamente" for "only"), or the user wouldn't know which answer a card wants, so any word matching
    // is a duplicate. The words are compared in memory, since the in-memory database used in development can't
    // ignore case in a query.
    private async Task<FlashCardWord?> FindClashAsync(List<string> spanish, List<string> english, int? exceptId)
    {
        var words = await dbContext.FlashCardWords
            .AsNoTracking()
            .Where(word => word.FlashCardId != exceptId)
            .ToListAsync();

        return FirstClash(words, Language.Spanish, spanish) ?? FirstClash(words, Language.English, english);
    }

    private static FlashCardWord? FirstClash(List<FlashCardWord> words, Language language, List<string> texts)
    {
        return texts
            .Select(text => words.FirstOrDefault(word => word.Language == language && SameText(word.Text, text)))
            .FirstOrDefault(word => word is not null);
    }

    // A 409 that says which word is taken.
    private ObjectResult DuplicateProblem(FlashCardWord clash)
    {
        return Problem(detail: DuplicateMessage(clash.Language, clash.Text), statusCode: StatusCodes.Status409Conflict);
    }

    private Task<FlashCard> LoadAsync(int id)
    {
        return dbContext.FlashCards
            .AsNoTracking()
            .Include(card => card.Words)
            .Include(card => card.Tags.OrderBy(tag => tag.Name))
            .AsSplitQuery()
            .SingleAsync(card => card.Id == id);
    }

    // Whether two lists hold the same words, ignoring case and order.
    private static bool SameWords(IReadOnlyList<string> a, List<string> b)
    {
        return a.Count == b.Count && a.All(word => b.Any(other => SameText(word, other)));
    }

    private static bool SameText(string a, string b)
    {
        return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }
}
