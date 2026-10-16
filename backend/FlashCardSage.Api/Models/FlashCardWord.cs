namespace FlashCardSage.Api.Models;

// One of a card's Spanish or English words. A card has at least one in each language, in the order the user typed
// them, and a word is only ever on one of a user's cards. It's only reached through its card, which returns its
// words as lists, so it's never returned itself.
public class FlashCardWord : IUserOwned
{
    public int Id { get; set; }

    public int FlashCardId { get; set; }

    // The card's owner, copied onto the word so the database can keep each word on only one of their cards.
    public int UserId { get; set; }

    public Language Language { get; set; }

    public string Text { get; set; } = string.Empty;

    // Where the word goes among the card's words in its language, from 0.
    public int Position { get; set; }
}
