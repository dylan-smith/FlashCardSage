using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

public class PracticeResultRequest
{
    // Nullable so a missing outcome is refused rather than read as the default.
    [Required]
    [EnumDataType(typeof(PracticeOutcome))]
    public PracticeOutcome? Outcome { get; set; }
}
