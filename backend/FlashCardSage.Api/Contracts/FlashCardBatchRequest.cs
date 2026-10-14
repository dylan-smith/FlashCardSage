using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

// Cards to add all at once, such as the ones scanned from a document.
public class FlashCardBatchRequest
{
    // As many as a document scan makes.
    public const int MaxCards = 100;

    [Required]
    [MaxLength(MaxCards)]
    public List<FlashCardRequest> Cards { get; set; } = [];
}
