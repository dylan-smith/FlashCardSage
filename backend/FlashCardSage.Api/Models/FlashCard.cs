using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// A meaning, with one or more Spanish words or phrases for it and one or more English ones (e.g. "solo" and
// "únicamente" for "only").
public class FlashCard
{
    // The most words a card can have in each language.
    public const int MaxWordsPerSide = 10;

    // The longest a word or phrase can be.
    public const int MaxWordLength = 200;

    public int Id { get; set; }

    // The card's Spanish words, in order.
    [NotMapped]
    public IReadOnlyList<string> Spanish => WordsIn(Language.Spanish);

    // The card's English words, in order.
    [NotMapped]
    public IReadOnlyList<string> English => WordsIn(Language.English);

    // The public URL of the card's picture, in blob storage (or on disk in local development), or null when it has
    // none.
    [MaxLength(MaxImageUrlLength)]
    public string? ImageUrl { get; set; }

    // Longer than any URL the image stores make, with room to spare.
    public const int MaxImageUrlLength = 400;

    // The card is returned as it is, and callers only ever see their own, so the owner isn't part of it.
    [JsonIgnore]
    public int UserId { get; set; }

    // Returned as the Spanish and English lists, so it has to be loaded with the card.
    [JsonIgnore]
    public List<FlashCardWord> Words { get; set; } = [];

    public List<Tag> Tags { get; set; } = [];

    // Only used to practice a deck's cards, so it's never returned. A deck lists its cards itself.
    [JsonIgnore]
    public List<Deck> Decks { get; set; } = [];

    private List<string> WordsIn(Language language)
    {
        return Words
            .Where(word => word.Language == language)
            .OrderBy(word => word.Position)
            .Select(word => word.Text)
            .ToList();
    }
}
