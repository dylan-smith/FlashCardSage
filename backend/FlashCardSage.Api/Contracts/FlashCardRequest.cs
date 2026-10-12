using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

public class FlashCardRequest
{
    [Required]
    [MaxLength(200)]
    public string Spanish { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string English { get; set; } = string.Empty;
}
