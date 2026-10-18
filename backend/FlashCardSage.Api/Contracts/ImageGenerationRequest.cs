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

    // The ID of the last picture the user was shown for these words, to get the next one, or null for the first.
    public int? AfterId { get; set; }
}
