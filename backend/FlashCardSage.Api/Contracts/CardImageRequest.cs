using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

// A picture to put on a card, as base64.
public class CardImageRequest
{
    [Required]
    public string ContentType { get; set; } = string.Empty;

    [Required]
    public string Data { get; set; } = string.Empty;
}
