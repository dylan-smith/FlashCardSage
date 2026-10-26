using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// The Spanish words or phrases of one card to hear, in order.
public class SpeechRequest
{
    [Required]
    [MinLength(1)]
    [MaxLength(FlashCard.MaxWordsPerSide)]
    public List<string> Texts { get; set; } = [];

    // Has the voice say them slowly, for a learner who can't make them out at its normal speed.
    public bool Slow { get; set; }
}
