using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

// Answers the device kept while practicing, oldest first, to record all at once.
public class PracticeResultsSyncRequest
{
    // Plenty more than the device sends at once.
    public const int MaxResults = 500;

    [Required]
    [MinLength(1)]
    [MaxLength(MaxResults)]
    public List<PracticeResultSyncItem> Results { get; set; } = [];
}
