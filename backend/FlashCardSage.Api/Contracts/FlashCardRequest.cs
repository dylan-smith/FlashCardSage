using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

public class FlashCardRequest
{
    [Required]
    [MaxLength(200)]
    public string Spanish { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string English { get; set; } = string.Empty;

    // The names of the card's tags. A name the user doesn't have a tag for yet makes a new tag.
    public List<string> Tags { get; set; } = [];
}
