using FlashCardSage.Api.Images;

namespace FlashCardSage.Api.Tests;

// Stands in for blob storage: hands out a URL for each picture saved, and remembers what's saved and deleted.
internal sealed class FakeImageStore : IImageStore
{
    public const string BaseUrl = "https://images.test/card-images/";

    public List<(string Url, string ContentType, byte[] Data)> Saved { get; } = [];

    public List<string> Deleted { get; } = [];

    public Exception? SaveFailure { get; init; }

    public Exception? DeleteFailure { get; init; }

    public Task<string> SaveAsync(ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken)
    {
        if (SaveFailure is not null)
        {
            return Task.FromException<string>(SaveFailure);
        }

        var url = $"{BaseUrl}{Saved.Count + 1}.jpg";
        Saved.Add((url, contentType, data.ToArray()));
        return Task.FromResult(url);
    }

    public Task DeleteAsync(string url, CancellationToken cancellationToken)
    {
        Deleted.Add(url);
        return DeleteFailure is null ? Task.CompletedTask : Task.FromException(DeleteFailure);
    }
}
