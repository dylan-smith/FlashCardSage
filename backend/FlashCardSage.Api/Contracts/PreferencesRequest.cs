using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

// All of the user's preferences, which replace the ones they had.
public class PreferencesRequest
{
    // Nullable so a missing preference is refused rather than read as off.
    [Required]
    public bool? ShowPictures { get; set; }

    [Required]
    public bool? ShowSuggestions { get; set; }

    [Required]
    public bool? AutoTranslate { get; set; }
}
