using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.SystemDecks;

/// <summary>
/// Puts the built-in decks in the database when the API starts, owned by the system user, so users can import them
/// (see SystemDecksController). Only decks the system user doesn't have yet are added: a deck that's already there
/// is left as it is, since users who imported it have their own copy anyway.
/// </summary>
public static class SystemDeckSeeder
{
    /// <summary>
    /// Adds the decks the system user doesn't have yet, by name. The current user becomes the system user, so the
    /// context's query filters and owner work for its rows as they do for anyone's, and the context shouldn't be used
    /// for anything else afterwards.
    /// </summary>
    /// <returns>How many decks were added.</returns>
    public static async Task<int> SeedAsync(
        FlashCardDbContext dbContext,
        CurrentUser currentUser,
        IReadOnlyList<SystemDeckDefinition> definitions,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(currentUser);
        ArgumentNullException.ThrowIfNull(definitions);

        await UserAccounts.BecomeSystemUserAsync(dbContext, currentUser, cancellationToken);

        var deckNames = await dbContext.Decks.Select(deck => deck.Name).ToListAsync(cancellationToken);
        var missing = definitions
            .Where(definition => !deckNames.Contains(definition.Name, TextRules.Comparer))
            .ToList();

        if (missing.Count == 0)
        {
            return 0;
        }

        // Decks can share cards and tags, so ones that are already there are used again. They're matched in memory,
        // since the in-memory database used in development can't ignore case in a query.
        var cards = await dbContext.FlashCards.WithWordsAndTags().ToListAsync(cancellationToken);
        var tags = await dbContext.Tags.ToListAsync(cancellationToken);

        foreach (var definition in missing)
        {
            var deck = new Deck { Name = definition.Name };

            foreach (var cardDefinition in definition.Cards)
            {
                // A word is only ever on one card, so a card with any of these Spanish words is this one.
                var card = cards.FirstOrDefault(item =>
                    item.Spanish.Any(word => cardDefinition.Spanish.Any(text => TextRules.SameText(word, text))));
                if (card is null)
                {
                    card = new FlashCard
                    {
                        Words =
                        [
                            .. FlashCard.NewWords(Language.Spanish, cardDefinition.Spanish),
                            .. FlashCard.NewWords(Language.English, cardDefinition.English)
                        ]
                    };
                    cards.Add(card);
                }

                foreach (var tagName in cardDefinition.Tags)
                {
                    var tag = tags.FindOrAdd(tagName);
                    if (!card.Tags.Contains(tag))
                    {
                        card.Tags.Add(tag);
                    }
                }

                deck.FlashCards.Add(card);
            }

            dbContext.Decks.Add(deck);
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        return missing.Count;
    }
}
