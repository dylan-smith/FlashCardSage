namespace FlashCardSage.Api.Suggestions.Foundry;

// Azure AI Foundry settings for the chat model, from the CardSuggestions configuration section (named for the first
// feature that used it, and shared by the tag suggester and the document scanner). Suggestions are off without an
// endpoint and a key.
public class FoundryChatOptions
{
    public const string SectionName = "CardSuggestions";

    // The Foundry resource's Azure OpenAI endpoint, e.g. https://flashcardsage-foundry.openai.azure.com/.
    public string Endpoint { get; set; } = string.Empty;

    public string Key { get; set; } = string.Empty;

    // The name of the chat model's deployment on the resource.
    public string Deployment { get; set; } = "gpt-5-mini";

    // False when no chat model is set up, e.g. in local development and E2E tests.
    public bool IsAvailable => !string.IsNullOrWhiteSpace(Endpoint) && !string.IsNullOrWhiteSpace(Key);
}
