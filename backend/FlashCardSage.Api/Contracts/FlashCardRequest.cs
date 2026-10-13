using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

public class FlashCardRequest
{
    // The card's Spanish words, in order. Blanks and repeats are left out, and at least one has to be left.
    [Required]
    public List<string> Spanish { get; set; } = [];

    // The card's English words, the same way.
    [Required]
    public List<string> English { get; set; } = [];

    // The names of the card's tags. A name the user doesn't have a tag for yet makes a new tag.
    public List<string> Tags { get; set; } = [];
}
