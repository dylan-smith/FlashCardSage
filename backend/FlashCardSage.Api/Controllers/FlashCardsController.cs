using System.Runtime.ExceptionServices;
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
    ILogger<FlashCardsController> logger) : ApiControllerBase
{
    // The 409 for a word that's already on another of the user's cards. A word with more than one translation
    // belongs on one card, so the user is pointed at that card.
    public static string DuplicateMessage(Language language, string word)
    {
        return $"You already have a flash card with the {language} \"{word}\". Add this translation to that card instead.";
    }

    public const string BatchClashMessage = "Your cards changed while these were being added. Try again.";

    // In the order they were made, so a list of words stays in the order it was typed in.
    [HttpGet]
    public async Task<ActionResult<IEnumerable<FlashCard>>> GetAll()
    {
        logger.LogInformation("Retrieving all flash cards");

        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .WithWordsAndTags()
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
            .WithWordsAndTags()
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
        card.SetWords(Language.Spanish, spanish);
        card.SetWords(Language.English, english);

        dbContext.FlashCards.Add(card);

        if (await dbContext.TrySaveUniqueAsync(CancellationToken.None) is { } failure)
        {
            // A card saved since the check above failed the unique index on its words.
            var saved = await FindClashAsync(spanish, english, exceptId: null);

            if (saved is null)
            {
                ExceptionDispatchInfo.Throw(failure);
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
            .WithWordsAndTags()
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
        card.SetWords(Language.Spanish, spanish);
        card.SetWords(Language.English, english);
        card.Tags.Clear();
        card.Tags.AddRange(tags);

        if (await dbContext.TrySaveUniqueAsync(CancellationToken.None) is { } failure)
        {
            // Another card saved since the check above failed the unique index. A retried update can't do that,
            // since it only writes this card's words again, so it's always a duplicate.
            var saved = await FindClashAsync(spanish, english, exceptId: id);

            if (saved is null)
            {
                ExceptionDispatchInfo.Throw(failure);
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
            .WithWordsAndTags()
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

    // Adds the cards, such as the ones scanned from a document, leaving out any card whose Spanish or English is
    // already on one of the user's cards or an earlier card in the list, as importing a built-in deck does, rather than
    // refusing them all.
    [HttpPost("batch")]
    public async Task<ActionResult<FlashCardBatchResponse>> CreateMany([FromBody] FlashCardBatchRequest request)
    {
        var trimmed = new List<(List<string> Spanish, List<string> English, List<string> TagNames)>();
        for (var index = 0; index < request.Cards.Count; index++)
        {
            TryTrim(request.Cards[index], out var spanish, out var english, out var tagNames, $"Cards[{index}].");
            trimmed.Add((spanish, english, tagNames));
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // The words on the user's cards, which each card added here takes too.
        var taken = await TakenWords.LoadAsync(dbContext, exceptCardId: null, CancellationToken.None);
        var tags = await dbContext.Tags.ToListAsync();

        var cards = new List<FlashCard>();
        foreach (var (spanish, english, tagNames) in trimmed)
        {
            if (taken.FirstClash(spanish, english) is not null)
            {
                continue;
            }

            var card = new FlashCard { Tags = FindOrMakeTags(tags, tagNames) };
            card.SetWords(Language.Spanish, spanish);
            card.SetWords(Language.English, english);
            taken.Add(card);
            cards.Add(card);
        }

        dbContext.FlashCards.AddRange(cards);

        if (await dbContext.TrySaveUniqueAsync(CancellationToken.None) is not null)
        {
            // A card saved since the check above failed the unique index on its words.
            logger.LogWarning("Refused to add flash cards over cards saved meanwhile");
            return ConflictProblem(BatchClashMessage);
        }

        logger.LogInformation(
            "Created {Count} flash cards, skipping {SkippedCount}", cards.Count, trimmed.Count - cards.Count);

        return Ok(new FlashCardBatchResponse(cards, trimmed.Count - cards.Count));
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
                .WithWordsAndTags()
                .Where(item => ids.Contains(item.Id))
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
    // error if one is too long. The errors' keys start with prefix, which says which card in a list it is.
    private bool TryTrim(
        FlashCardRequest request,
        out List<string> spanish,
        out List<string> english,
        out List<string> tagNames,
        string prefix = "")
    {
        spanish = TextRules.CleanWords(request.Spanish, dedupe: true);
        english = TextRules.CleanWords(request.English, dedupe: true);
        tagNames = TextRules.CleanWords(request.Tags, dedupe: true);

        CheckWords(prefix + nameof(request.Spanish), Language.Spanish, spanish);
        CheckWords(prefix + nameof(request.English), Language.English, english);

        if (tagNames.Any(name => name.Length > Tag.MaxNameLength))
        {
            ModelState.AddModelError(
                prefix + nameof(request.Tags), $"Tags can be at most {Tag.MaxNameLength} characters.");
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

    // The user's tags with these names, in name order, with a new tag for each name they don't have yet (see TagList).
    private async Task<List<Tag>> FindOrMakeTagsAsync(List<string> names)
    {
        return names.Count == 0 ? [] : FindOrMakeTags(await dbContext.Tags.ToListAsync(), names);
    }

    // The same, from the user's tags, which a new tag is added to, so other cards being added with it use it too.
    private static List<Tag> FindOrMakeTags(List<Tag> existing, List<string> names)
    {
        return names.Select(existing.FindOrAdd).OrderedByName();
    }

    // A word on another of the user's cards that's one of these Spanish words, or else one of these English ones,
    // ignoring case, or null when none is taken (see TakenWords).
    private async Task<FlashCardWord?> FindClashAsync(List<string> spanish, List<string> english, int? exceptId)
    {
        var taken = await TakenWords.LoadAsync(dbContext, exceptId, CancellationToken.None);
        return taken.FirstClash(spanish, english);
    }

    // A 409 that says which word is taken.
    private ObjectResult DuplicateProblem(FlashCardWord clash)
    {
        return ConflictProblem(DuplicateMessage(clash.Language, clash.Text));
    }

    private Task<FlashCard> LoadAsync(int id)
    {
        return dbContext.FlashCards
            .AsNoTracking()
            .WithWordsAndTags()
            .SingleAsync(card => card.Id == id);
    }

    // Whether two lists hold the same words, ignoring case and order.
    private static bool SameWords(IReadOnlyList<string> a, List<string> b)
    {
        return a.Count == b.Count && a.All(word => b.Any(other => TextRules.SameText(word, other)));
    }
}
