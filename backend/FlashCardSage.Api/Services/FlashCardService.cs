using System.Runtime.ExceptionServices;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Adds, changes and deletes the user's cards (see FlashCardsController), keeping each word on only one of their cards
/// (see TakenWords).
/// </summary>
/// <remarks>
/// Log statements include ids only, never a card's words or tags, to prevent log-forging.
/// </remarks>
public class FlashCardService(
    FlashCardDbContext dbContext,
    IImageStore imageStore,
    ILogger<FlashCardService> logger)
{
    public async Task<CardResult> CreateAsync(FlashCardRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var errors = new List<KeyValuePair<string, string>>();
        var (spanish, english, tagNames) = Trim(request, errors);
        if (errors.Count > 0)
        {
            return new CardResult.Invalid(errors);
        }

        if (await FindClashAsync(spanish, english, exceptId: null) is { } clash)
        {
            logger.LogWarning("Refused a duplicate flash card");
            return new CardResult.Duplicate(clash);
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
                return new CardResult.Created(savedCard);
            }

            logger.LogWarning("Refused a duplicate flash card");
            return new CardResult.Duplicate(saved);
        }

        logger.LogInformation("Created flash card {FlashCardId}", card.Id);

        return new CardResult.Created(card);
    }

    public async Task<CardResult> UpdateAsync(int id, FlashCardRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var card = await dbContext.FlashCards
            .WithWordsAndTags()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for update", id);
            return new CardResult.NotFound();
        }

        var errors = new List<KeyValuePair<string, string>>();
        var (spanish, english, tagNames) = Trim(request, errors);
        if (errors.Count > 0)
        {
            return new CardResult.Invalid(errors);
        }

        if (await FindClashAsync(spanish, english, exceptId: id) is { } clash)
        {
            logger.LogWarning("Refused to make flash card {FlashCardId} a duplicate", id);
            return new CardResult.Duplicate(clash);
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
            return new CardResult.Duplicate(saved);
        }

        logger.LogInformation("Updated flash card {FlashCardId}", id);

        return new CardResult.Updated(card);
    }

    // Whether the card was found and deleted.
    public async Task<bool> DeleteAsync(int id)
    {
        // The words and tags are loaded so EF removes them and the card's links to the tags, as the database would.
        // The in-memory database used in development only cascades to what's loaded, and would keep the words.
        var card = await dbContext.FlashCards
            .WithWordsAndTags()
            .FirstOrDefaultAsync(item => item.Id == id);

        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for deletion", id);
            return false;
        }

        dbContext.FlashCards.Remove(card);
        await dbContext.SaveChangesAsync();

        // Once the card is gone, so nothing points at the picture, it's removed too, unless it's a cached one.
        if (card.ImageUrl is { } imageUrl)
        {
            await imageStore.TryDeleteCardPicturesAsync(dbContext, [imageUrl], logger, CancellationToken.None);
        }

        logger.LogInformation("Deleted flash card {FlashCardId}", id);

        return true;
    }

    // Adds the cards, such as the ones scanned from a document, leaving out any card whose Spanish or English is
    // already on one of the user's cards or an earlier card in the list, as importing a built-in deck does, rather than
    // refusing them all. The errors' fields start with "Cards[index].", which says which card it is.
    public async Task<CardResult> CreateManyAsync(IReadOnlyList<FlashCardRequest> requests)
    {
        ArgumentNullException.ThrowIfNull(requests);

        var errors = new List<KeyValuePair<string, string>>();
        var trimmed = requests.Select((request, index) => Trim(request, errors, $"Cards[{index}].")).ToList();

        if (errors.Count > 0)
        {
            return new CardResult.Invalid(errors);
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
            return new CardResult.Clash();
        }

        logger.LogInformation(
            "Created {Count} flash cards, skipping {SkippedCount}", cards.Count, trimmed.Count - cards.Count);

        return new CardResult.CreatedMany(cards, trimmed.Count - cards.Count);
    }

    // Deletes many cards at once, such as all the ones picked on the cards page, returning how many were deleted. A
    // card that's already gone is what the caller wanted, and another user's is never found through the query filter,
    // so both are skipped.
    public async Task<int> DeleteManyAsync(IEnumerable<int> flashCardIds)
    {
        var ids = flashCardIds.Distinct().ToList();

        // Loaded with their words and tags for the same reason as in DeleteAsync.
        var cards = ids.Count == 0
            ? []
            : await dbContext.FlashCards
                .WithWordsAndTags()
                .Where(item => ids.Contains(item.Id))
                .ToListAsync();

        dbContext.FlashCards.RemoveRange(cards);
        await dbContext.SaveChangesAsync();

        await imageStore.TryDeleteCardPicturesAsync(
            dbContext, cards.Select(card => card.ImageUrl), logger, CancellationToken.None);

        logger.LogInformation("Deleted {Count} flash cards", cards.Count);

        return cards.Count;
    }

    // Trims each side's words, leaving out blanks and repeats (ignoring case), and adds an error for a side that's left
    // with none, too many or one that's too long. The tag names are trimmed the same way, with an error if one is too
    // long. The errors' fields start with prefix, which says which card in a list it is.
    private static (List<string> Spanish, List<string> English, List<string> TagNames) Trim(
        FlashCardRequest request, List<KeyValuePair<string, string>> errors, string prefix = "")
    {
        var spanish = TextRules.CleanWords(request.Spanish, dedupe: true);
        var english = TextRules.CleanWords(request.English, dedupe: true);
        var tagNames = TextRules.CleanWords(request.Tags, dedupe: true);

        CheckWords(errors, prefix + nameof(request.Spanish), Language.Spanish, spanish);
        CheckWords(errors, prefix + nameof(request.English), Language.English, english);

        if (tagNames.Any(name => name.Length > Tag.MaxNameLength))
        {
            errors.Add(new(prefix + nameof(request.Tags), $"Tags can be at most {Tag.MaxNameLength} characters."));
        }

        return (spanish, english, tagNames);
    }

    private static void CheckWords(
        List<KeyValuePair<string, string>> errors, string field, Language language, List<string> words)
    {
        if (words.Count == 0)
        {
            errors.Add(new(field, $"{language} is required."));
        }
        else if (words.Count > FlashCard.MaxWordsPerSide)
        {
            errors.Add(new(field, $"A flash card can have at most {FlashCard.MaxWordsPerSide} {language} translations."));
        }
        else if (words.Any(word => word.Length > FlashCard.MaxWordLength))
        {
            errors.Add(new(field, $"{language} can be at most {FlashCard.MaxWordLength} characters."));
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
