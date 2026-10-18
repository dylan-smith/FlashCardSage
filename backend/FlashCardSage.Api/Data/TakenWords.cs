using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

/// <summary>
/// The words on the user's cards, by language. A word with more than one translation belongs on one card (e.g. "solo"
/// and "únicamente" for "only"), or the user wouldn't know which answer a card wants, so a word can only ever be on one
/// of a user's cards, and a card with any word that's taken is a duplicate.
/// </summary>
/// <remarks>
/// The words are compared in memory, ignoring case (see TextRules), since the in-memory database used in development
/// can't ignore case in a query.
/// </remarks>
public sealed class TakenWords
{
    // Each language's words by their text, keeping the first of any that differ only in case.
    private readonly Dictionary<Language, Dictionary<string, FlashCardWord>> byLanguage =
        Enum.GetValues<Language>().ToDictionary(language => language, _ => new Dictionary<string, FlashCardWord>(TextRules.Comparer));

    /// <summary>
    /// The words on the user's cards, found through the query filter, leaving out the card with exceptCardId (the one
    /// being changed) when there is one.
    /// </summary>
    public static async Task<TakenWords> LoadAsync(
        FlashCardDbContext dbContext, int? exceptCardId, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);

        var words = await dbContext.FlashCardWords
            .AsNoTracking()
            .Where(word => word.FlashCardId != exceptCardId)
            .ToListAsync(cancellationToken);

        var taken = new TakenWords();
        foreach (var word in words)
        {
            taken.Add(word);
        }

        return taken;
    }

    // The words on these cards, which have their words loaded.
    public static TakenWords From(IEnumerable<FlashCard> cards)
    {
        ArgumentNullException.ThrowIfNull(cards);

        var taken = new TakenWords();
        foreach (var card in cards)
        {
            taken.Add(card);
        }

        return taken;
    }

    public bool Contains(Language language, string text)
    {
        return byLanguage[language].ContainsKey(text);
    }

    // Whether any of the card's words is taken, so it can't be another of the user's cards.
    public bool ContainsAny(FlashCard card)
    {
        ArgumentNullException.ThrowIfNull(card);

        return card.Words.Any(word => Contains(word.Language, word.Text));
    }

    // The taken word that's one of these Spanish words, or else one of these English ones, in their order, or null
    // when none is taken.
    public FlashCardWord? FirstClash(IEnumerable<string> spanish, IEnumerable<string> english)
    {
        return FirstClash(Language.Spanish, spanish) ?? FirstClash(Language.English, english);
    }

    // Takes the card's words too, such as one about to be added along with others.
    public void Add(FlashCard card)
    {
        ArgumentNullException.ThrowIfNull(card);

        foreach (var word in card.Words)
        {
            Add(word);
        }
    }

    public void Add(Language language, string text)
    {
        Add(new FlashCardWord { Language = language, Text = text });
    }

    private void Add(FlashCardWord word)
    {
        byLanguage[word.Language].TryAdd(word.Text, word);
    }

    private FlashCardWord? FirstClash(Language language, IEnumerable<string> texts)
    {
        ArgumentNullException.ThrowIfNull(texts);

        return texts
            .Select(text => byLanguage[language].GetValueOrDefault(text))
            .FirstOrDefault(word => word is not null);
    }
}
