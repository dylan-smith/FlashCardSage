using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// An answer to a sentence in Sentences practice mode. Every property is nullable so a missing one is refused rather
// than read as the default.
public class SentencePracticeResultRequest
{
    [Required]
    [MaxLength(SentencePracticeResult.MaxSentenceLength)]
    public string? Spanish { get; set; }

    [Required]
    [MaxLength(SentencePracticeResult.MaxSentenceLength)]
    public string? English { get; set; }

    // The user's cards the sentence used.
    [Required]
    [MaxLength(SentencePracticeResult.MaxCards)]
    public List<int>? CardIds { get; set; }

    // The side the user was shown first.
    [Required]
    [EnumDataType(typeof(Language))]
    public Language? ShownSide { get; set; }

    // Whether the Spanish was heard rather than read first.
    [Required]
    public bool? Listening { get; set; }

    [Required]
    [EnumDataType(typeof(PracticeOutcome))]
    public PracticeOutcome? Outcome { get; set; }
}
