using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// A built-in deck with its cards, which the user hasn't got, so they're sent in full.
public record SystemDeckResponse(int Id, string Name, IReadOnlyList<SystemDeckCard> Cards)
{
    public static SystemDeckResponse From(Deck deck)
    {
        ArgumentNullException.ThrowIfNull(deck);
        return new SystemDeckResponse(
            deck.Id,
            deck.Name,
            [.. deck.FlashCards.OrderBy(card => card.Id).Select(SystemDeckCard.From)]);
    }
}

public record SystemDeckCard(string Spanish, string English, IReadOnlyList<string> Tags)
{
    public static SystemDeckCard From(FlashCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        return new SystemDeckCard(card.Spanish, card.English, [.. card.Tags.Select(tag => tag.Name).Order()]);
    }
}
