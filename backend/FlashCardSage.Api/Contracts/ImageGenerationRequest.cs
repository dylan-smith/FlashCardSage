using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// The sides of the card to make a picture for. Either can be blank, but not both.
public class ImageGenerationRequest
{
    [MaxLength(FlashCard.MaxWordLength)]
    public string? Spanish { get; set; }

    [MaxLength(FlashCard.MaxWordLength)]
    public string? English { get; set; }
}
