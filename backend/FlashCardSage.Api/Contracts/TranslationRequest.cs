using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

public class TranslationRequest
{
    [Required]
    [MaxLength(200)]
    public string Text { get; set; } = string.Empty;

    // Nullable so a missing language is refused rather than read as the default.
    [Required]
    [EnumDataType(typeof(Language))]
    public Language? From { get; set; }
}
