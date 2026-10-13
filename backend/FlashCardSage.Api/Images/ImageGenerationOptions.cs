namespace FlashCardSage.Api.Images;

// Azure OpenAI settings, from the ImageGeneration configuration section. Pictures are off without an endpoint and
// a key.
public class ImageGenerationOptions
{
    public const string SectionName = "ImageGeneration";

    // The resource's endpoint, e.g. https://flashcardsage-openai.openai.azure.com/.
    public string Endpoint { get; set; } = string.Empty;

    public string Key { get; set; } = string.Empty;

    // The name of the image model's deployment on the resource.
    public string Deployment { get; set; } = "gpt-image-1-mini";

    public string ApiVersion { get; set; } = "2025-04-01-preview";
}
