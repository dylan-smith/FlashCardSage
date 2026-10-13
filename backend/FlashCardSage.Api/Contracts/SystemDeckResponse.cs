using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// A built-in deck with its cards, which the user hasn't got, so they're sent in full, like the user's own cards.
public record SystemDeckResponse(int Id, string Name, IReadOnlyList<FlashCard> Cards)
{
    public static SystemDeckResponse From(Deck deck)
    {
        ArgumentNullException.ThrowIfNull(deck);
        return new SystemDeckResponse(deck.Id, deck.Name, [.. deck.FlashCards.OrderBy(card => card.Id)]);
    }
}
