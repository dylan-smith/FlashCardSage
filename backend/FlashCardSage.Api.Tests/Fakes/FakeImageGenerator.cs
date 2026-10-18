using FlashCardSage.Api.Images;
using FlashCardSage.Api.Tests.TestData;

namespace FlashCardSage.Api.Tests.Fakes;

// Stands in for the image generator: makes the same picture each time, or fails, and remembers the words it was given.
internal sealed class FakeImageGenerator : IImageGenerator
{
    public bool IsAvailable { get; init; } = true;

    public GeneratedImage Result { get; set; } = new("image/jpeg", SampleImages.Jpeg);

    public Exception? Failure { get; init; }

    public List<(string Spanish, string English)> Calls { get; } = [];

    // The words of the last call, or null when there's been none.
    public (string Spanish, string English)? Words => Calls.Count > 0 ? Calls[^1] : null;

    public Task<GeneratedImage> GenerateAsync(string spanish, string english, CancellationToken cancellationToken)
    {
        Calls.Add((spanish, english));
        return Failure is null ? Task.FromResult(Result) : Task.FromException<GeneratedImage>(Failure);
    }
}
