using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// One go at a sentence in Sentences practice mode, kept to learn from: it doesn't count toward any card's score. It
// uses several cards, so unlike a card's practice result it belongs to the user directly, and the cards' ids are kept
// as they were, so a deleted card's id stays in the record.
public class SentencePracticeResult : IUserOwned
{
    public const int MaxSentenceLength = 300;

    public const int MaxCards = 10;

    public int Id { get; set; }

    // Like a card's, the owner is set when the result is saved, and isn't part of what callers see.
    [JsonIgnore]
    public int UserId { get; set; }

    public string Spanish { get; set; } = string.Empty;

    public string English { get; set; } = string.Empty;

    // The user's cards the sentence used.
    public List<int> CardIds { get; set; } = [];

    // The side the user was shown first.
    public Language ShownSide { get; set; }

    // Whether the sentence was practiced in listening mode, heard rather than read.
    public bool Listening { get; set; }

    public PracticeOutcome Outcome { get; set; }

    public DateTimeOffset PracticedAt { get; set; }
}
