using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// A deck and the ids of its cards, in card order. Callers already have the cards themselves.
public record DeckResponse(int Id, string Name, IReadOnlyList<int> FlashCardIds)
{
    public static DeckResponse From(Deck deck)
    {
        ArgumentNullException.ThrowIfNull(deck);
        return new DeckResponse(deck.Id, deck.Name, [.. deck.FlashCards.Select(card => card.Id).Order()]);
    }
}
