using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

// The related rows the API loads with cards, tags and decks.
public static class FlashCardQueries
{
    // The cards with their words, which they're returned with as their Spanish and English lists, and their tags, in
    // name order, as the endpoints return them.
    public static IQueryable<FlashCard> WithWordsAndTags(this IQueryable<FlashCard> cards)
    {
        return cards
            .Include(card => card.Words)
            .Include(card => card.Tags.OrderBy(tag => tag.Name))
            .AsSplitQuery();
    }

    // The cards with their words, for the Spanish and English lists.
    public static IQueryable<FlashCard> WithWords(this IQueryable<FlashCard> cards)
    {
        return cards.Include(card => card.Words);
    }

    // The tags, each with its newest cards and their words, which show what goes under it.
    public static IQueryable<Tag> WithRecentCards(this IQueryable<Tag> tags, int count)
    {
        return tags
            .Include(tag => tag.FlashCards.OrderByDescending(card => card.Id).Take(count))
            .ThenInclude(card => card.Words)
            .AsSplitQuery();
    }

    // The decks with their cards, which a deck lists by id.
    public static IQueryable<Deck> WithCards(this IQueryable<Deck> decks)
    {
        return decks.Include(deck => deck.FlashCards);
    }
}
