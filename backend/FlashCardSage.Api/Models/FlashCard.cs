using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// A Spanish word or phrase and its English translation.
public class FlashCard
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Spanish { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string English { get; set; } = string.Empty;

    // The card is returned as it is, and callers only ever see their own, so the owner isn't part of it.
    [JsonIgnore]
    public int UserId { get; set; }

    public List<Tag> Tags { get; set; } = [];

    // Only used to practice a deck's cards, so it's never returned. A deck lists its cards itself.
    [JsonIgnore]
    public List<Deck> Decks { get; set; } = [];
}
