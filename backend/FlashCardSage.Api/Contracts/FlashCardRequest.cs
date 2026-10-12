using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

public class FlashCardRequest
{
    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;
}
