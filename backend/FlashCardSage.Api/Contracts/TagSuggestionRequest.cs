using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// A card being added or changed, as typed so far, to suggest tags for.
public class TagSuggestionRequest
{
    // The card's Spanish words. Blanks are left out, and one side can be empty while the user hasn't filled it in.
    [MaxLength(FlashCard.MaxWordsPerSide)]
    public List<string> Spanish { get; set; } = [];

    // The card's English words, the same way.
    [MaxLength(FlashCard.MaxWordsPerSide)]
    public List<string> English { get; set; } = [];

    // The names of the tags already on the card, which aren't suggested.
    public List<string> Tags { get; set; } = [];
}
