namespace FlashCardSage.Api.Suggestions;

// Claude settings, from the CardSuggestions configuration section. Suggestions are off without an API key.
public class CardSuggesterOptions
{
    public const string SectionName = "CardSuggestions";

    public string ApiKey { get; set; } = string.Empty;

    public string Model { get; set; } = "claude-opus-5-5";
}
