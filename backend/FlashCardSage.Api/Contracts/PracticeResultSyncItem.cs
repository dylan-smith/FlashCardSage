using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// An answer the device kept while practicing, with the id it gave it, so sending it again doesn't record it twice.
// Every property is nullable so a missing one is refused rather than read as the default.
public class PracticeResultSyncItem
{
    [Required]
    public Guid? Id { get; set; }

    [Required]
    public int? FlashCardId { get; set; }

    [Required]
    [EnumDataType(typeof(PracticeOutcome))]
    public PracticeOutcome? Outcome { get; set; }

    [Required]
    public DateTimeOffset? PracticedAt { get; set; }
}
