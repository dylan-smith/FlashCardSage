namespace FlashCardSage.Api.Images;

public interface IImageGenerator
{
    // False when no image generation service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // Makes a picture of what a card means, from whichever of its sides are filled in. Throws
    // ImageContentFilteredException when the service refuses the words, and HttpRequestException when it fails.
    Task<GeneratedImage> GenerateAsync(string spanish, string english, CancellationToken cancellationToken);
}

public record GeneratedImage(string ContentType, ReadOnlyMemory<byte> Data);

// The service's safety system refused to illustrate the words, so other words might work where a retry won't.
public class ImageContentFilteredException : Exception
{
    public ImageContentFilteredException()
    {
    }

    public ImageContentFilteredException(string message) : base(message)
    {
    }

    public ImageContentFilteredException(string message, Exception innerException) : base(message, innerException)
    {
    }
}
