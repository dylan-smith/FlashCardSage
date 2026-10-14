using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

/// <summary>
/// What importing a deck of cards needs, whether from a built-in deck or from somewhere else such as Preply.
/// </summary>
internal static class DeckImport
{
    // The words on the user's cards, by language. Compared in memory, ignoring case, since the in-memory database used
    // in development can't in a query. A word is only ever on one of a user's cards, so a new card with any of them is
    // left out.
    public static async Task<Dictionary<Language, HashSet<string>>> TakenWordsAsync(
        FlashCardDbContext dbContext, CancellationToken cancellationToken)
    {
        var words = await dbContext.FlashCardWords
            .AsNoTracking()
            .Select(word => new { word.Language, word.Text })
            .ToListAsync(cancellationToken);

        return Enum.GetValues<Language>().ToDictionary(
            language => language,
            language => words
                .Where(word => word.Language == language)
                .Select(word => word.Text)
                .ToHashSet(StringComparer.OrdinalIgnoreCase));
    }

    // The name, or else the name with the first of " (2)", " (3)" and so on that none of the user's decks has, ignoring
    // case as the database's index does.
    public static async Task<string> UnusedDeckNameAsync(
        FlashCardDbContext dbContext, string name, CancellationToken cancellationToken)
    {
        var names = (await dbContext.Decks.Select(deck => deck.Name).ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var candidate = name;
        for (var number = 2; names.Contains(candidate); number++)
        {
            var suffix = $" ({number})";
            candidate = name[..Math.Min(name.Length, Deck.MaxNameLength - suffix.Length)] + suffix;
        }

        return candidate;
    }
}
