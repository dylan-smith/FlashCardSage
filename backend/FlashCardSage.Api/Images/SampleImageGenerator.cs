namespace FlashCardSage.Api.Images;

// Makes every picture the same one-pixel PNG, for the E2E tests (ImageGenerationOptions.UseSamplePicture), so their
// pictures go through the real cache and image store without Foundry.
public class SampleImageGenerator : IImageGenerator
{
    public const string ContentType = "image/png";

    private static readonly byte[] Picture = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");

    public bool IsAvailable => true;

    public Task<GeneratedImage> GenerateAsync(string spanish, string english, CancellationToken cancellationToken)
    {
        return Task.FromResult(new GeneratedImage(ContentType, Picture));
    }
}
