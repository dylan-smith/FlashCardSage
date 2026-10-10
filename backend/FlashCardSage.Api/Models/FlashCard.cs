using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

public class FlashCard
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    // The card is returned as it is, and callers only ever see their own, so the owner isn't part of it.
    [JsonIgnore]
    public int UserId { get; set; }
}
