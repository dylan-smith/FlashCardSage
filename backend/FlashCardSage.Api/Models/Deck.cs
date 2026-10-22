using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Models;

// A named set of the user's cards to practice, such as Food or Week 1.
public class Deck : IUserOwned
{
    public const int MaxNameLength = 50;

    public int Id { get; set; }

    [Required]
    [MaxLength(MaxNameLength)]
    public string Name { get; set; } = string.Empty;

    // Like a card's, the owner is set when the deck is saved. DeckResponse is what callers see.
    public int UserId { get; set; }

    // Set when the deck is saved, like a card's, and null for decks made before it was recorded.
    public DateTimeOffset? CreatedAt { get; set; }

    public List<FlashCard> FlashCards { get; set; } = [];
}
