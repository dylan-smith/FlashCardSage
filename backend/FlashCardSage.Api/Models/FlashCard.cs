using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// A meaning, with one or more Spanish words or phrases for it and one or more English ones (e.g. "solo" and
// "únicamente" for "only").
public class FlashCard : IUserOwned
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

    // New words in a language, in this order.
    public static IEnumerable<FlashCardWord> NewWords(Language language, IReadOnlyList<string> texts)
    {
        ArgumentNullException.ThrowIfNull(texts);

        return texts.Select((text, position) =>
            new FlashCardWord { Language = language, Text = text, Position = position });
    }

    // Makes the card's words in a language these, in this order. A word the card already has (whatever its case) is
    // kept and moved, so the database never sees it removed and added again, which the unique index could refuse.
    public void SetWords(Language language, IReadOnlyList<string> texts)
    {
        ArgumentNullException.ThrowIfNull(texts);

        var existing = Words.Where(word => word.Language == language).ToList();
        Words.RemoveAll(word =>
            word.Language == language && !texts.Any(text => TextRules.SameText(text, word.Text)));

        for (var position = 0; position < texts.Count; position++)
        {
            var word = existing.FirstOrDefault(item => TextRules.SameText(item.Text, texts[position]));
            if (word is null)
            {
                Words.Add(new FlashCardWord { Language = language, Text = texts[position], Position = position });
            }
            else
            {
                word.Text = texts[position];
                word.Position = position;
            }
        }
    }

    // A new card for the current user with this card's words and tags, but not yet its picture, such as a built-in
    // card being imported. The tags are found by name in the user's tags, with a new one for a name they haven't got,
    // which is kept with their tags so other cards being copied use it too.
    public FlashCard CopyForUser(List<Tag> tags)
    {
        return new FlashCard
        {
            Words =
            [
                .. Words.Select(word =>
                    new FlashCardWord { Language = word.Language, Text = word.Text, Position = word.Position })
            ],
            Tags = Tags.Select(tag => tags.FindOrAdd(tag.Name)).OrderedByName()
        };
    }

    private List<string> WordsIn(Language language)
    {
        return Words
            .Where(word => word.Language == language)
            .OrderBy(word => word.Position)
            .Select(word => word.Text)
            .ToList();
    }
}
