using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// A new deck. Its cards can be given here too, such as when cards picked on the cards page start a new deck.
public class DeckRequest
{
    [Required]
    [MaxLength(Deck.MaxNameLength)]
    public string Name { get; set; } = string.Empty;

    public List<int> FlashCardIds { get; set; } = [];
}
