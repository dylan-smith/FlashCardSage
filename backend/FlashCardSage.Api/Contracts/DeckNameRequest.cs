using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

public class DeckNameRequest
{
    [Required]
    [MaxLength(Deck.MaxNameLength)]
    public string Name { get; set; } = string.Empty;
}
