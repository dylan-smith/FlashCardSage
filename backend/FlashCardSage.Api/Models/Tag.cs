using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// A name the user puts on cards to organize them, such as Food or Travel.
public class Tag
{
    public const int MaxNameLength = 50;

    public int Id { get; set; }

    [Required]
    [MaxLength(MaxNameLength)]
    public string Name { get; set; } = string.Empty;

    // Like a card's, the owner isn't part of what callers see.
    [JsonIgnore]
    public int UserId { get; set; }

    // Only used to remove the tag from its cards when it's deleted, so it's never returned.
    [JsonIgnore]
    public List<FlashCard> FlashCards { get; set; } = [];
}
