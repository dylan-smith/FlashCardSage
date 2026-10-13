using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

// The sides of the card to make a picture for. Either can be blank, but not both.
public class ImageGenerationRequest
{
    [MaxLength(200)]
    public string? Spanish { get; set; }

    [MaxLength(200)]
    public string? English { get; set; }
}
