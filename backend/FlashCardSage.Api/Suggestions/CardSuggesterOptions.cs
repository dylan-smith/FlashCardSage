namespace FlashCardSage.Api.Suggestions;

// Azure AI Foundry settings, from the CardSuggestions configuration section. Suggestions are off without an
// endpoint and a key.
public class CardSuggesterOptions
{
    public const string SectionName = "CardSuggestions";

    // The Foundry resource's Azure OpenAI endpoint, e.g. https://flashcardsage-foundry.openai.azure.com/.
    public string Endpoint { get; set; } = string.Empty;

    public string Key { get; set; } = string.Empty;

    // The name of the chat model's deployment on the resource.
    public string Deployment { get; set; } = "gpt-5-mini";
}
