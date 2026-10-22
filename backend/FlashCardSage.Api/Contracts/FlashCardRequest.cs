using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

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

    // How the card was added, such as from a suggestion or a document scan. It's only read when a card is added
    // (Manual when it's left out) and ignored when one is changed. Inside a batch, the batch's Source is used instead.
    [EnumDataType(typeof(CardSource))]
    public CardSource? Source { get; set; }
}
