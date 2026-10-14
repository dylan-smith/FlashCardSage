using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

// The words from the user's Preply vocabulary that they picked to import, each with its English.
public class PreplyImportRequest
{
    [Required]
    public List<PreplyWord> Words { get; set; } = [];
}

// One word or phrase from Preply and its English, which become one card.
public class PreplyWord
{
    [Required]
    public string Spanish { get; set; } = string.Empty;

    [Required]
    public string English { get; set; } = string.Empty;
}
