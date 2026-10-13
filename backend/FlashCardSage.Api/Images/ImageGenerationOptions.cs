namespace FlashCardSage.Api.Images;

// Azure AI Foundry settings, from the ImageGeneration configuration section. Pictures are off without an endpoint
// and a key.
public class ImageGenerationOptions
{
    public const string SectionName = "ImageGeneration";

    // The Foundry resource's endpoint, e.g. https://flashcardsage-foundry.services.ai.azure.com/.
    public string Endpoint { get; set; } = string.Empty;

    public string Key { get; set; } = string.Empty;

    // The name of the image model's deployment on the resource. It's also the model's path in the Black Forest
    // Labs API (flux-2-pro, flux-2-flex), so a deployment is named after its model, in lowercase.
    public string Deployment { get; set; } = "flux-2-pro";

    public string ApiVersion { get; set; } = "preview";
}
