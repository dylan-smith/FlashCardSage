using System.ComponentModel.DataAnnotations;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

public class TagRequest
{
    [Required]
    [MaxLength(Tag.MaxNameLength)]
    public string Name { get; set; } = string.Empty;
}
