namespace FlashCardSage.Api.Translation;

// Azure AI Translator settings, from the Translator configuration section. Translation is off without a key.
public class TranslatorOptions
{
    public const string SectionName = "Translator";

    public string Endpoint { get; set; } = "https://api.cognitive.microsofttranslator.com";

    public string Key { get; set; } = string.Empty;
}
