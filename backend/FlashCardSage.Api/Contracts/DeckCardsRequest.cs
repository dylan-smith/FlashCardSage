namespace FlashCardSage.Api.Contracts;

// Cards to put in a deck and to take out of it. A deck can hold hundreds of cards, so a change only sends the cards
// it changes. Adding a card the deck has, or removing one it doesn't, changes nothing.
public class DeckCardsRequest
{
    public List<int> Add { get; set; } = [];

    public List<int> Remove { get; set; } = [];
}
