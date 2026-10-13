using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

public class DeckRequest
{
    [Required]
    [MaxLength(Deck.MaxNameLength)]
    public string Name { get; set; } = string.Empty;

    // Every card in the deck. Saving replaces the cards it had.
    public List<int> FlashCardIds { get; set; } = [];
}
