using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// A built-in deck with its cards, which the user hasn't got, so they're sent in full, like the user's own cards. The
// owned ids are the deck's cards the user already has, which importing would leave out.
public record SystemDeckResponse(int Id, string Name, IReadOnlyList<FlashCard> Cards, IReadOnlyList<int> OwnedCardIds)
{
    public static SystemDeckResponse From(Deck deck, Func<FlashCard, bool> owned)
    {
        ArgumentNullException.ThrowIfNull(deck);
        ArgumentNullException.ThrowIfNull(owned);
        var cards = deck.FlashCards.OrderBy(card => card.Id).ToList();
        return new SystemDeckResponse(deck.Id, deck.Name, cards, [.. cards.Where(owned).Select(card => card.Id)]);
    }
}
