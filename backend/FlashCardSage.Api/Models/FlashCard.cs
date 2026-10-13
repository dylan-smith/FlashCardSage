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

    // The public URL of the card's picture, in blob storage (or on disk in local development), or null when it has
    // none.
    [MaxLength(MaxImageUrlLength)]
    public string? ImageUrl { get; set; }

    // Longer than any URL the image stores make, with room to spare.
    public const int MaxImageUrlLength = 400;

    // The card is returned as it is, and callers only ever see their own, so the owner isn't part of it.
    [JsonIgnore]
    public int UserId { get; set; }

    public List<Tag> Tags { get; set; } = [];
}
