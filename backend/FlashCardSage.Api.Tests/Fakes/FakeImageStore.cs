using FlashCardSage.Api.Images;

namespace FlashCardSage.Api.Tests.Fakes;

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

    // Saves under the name, unless it's saved already, like the real stores.
    public Task<string> SaveAsync(string name, ReadOnlyMemory<byte> data, CancellationToken cancellationToken)
    {
        if (SaveFailure is not null)
        {
            return Task.FromException<string>(SaveFailure);
        }

        var url = BaseUrl + name;
        if (!Saved.Exists(item => item.Url == url))
        {
            Saved.Add((url, CardImage.ContentTypeOf(name), data.ToArray()));
        }

        return Task.FromResult(url);
    }

    public Exception? CopyFailure { get; init; }

    // Copies a picture this store saved and hasn't deleted, like the real stores, saving the copy as a new one.
    public async Task<string?> CopyAsync(string url, CancellationToken cancellationToken)
    {
        if (CopyFailure is not null)
        {
            throw CopyFailure;
        }

        var original = Saved.Find(item => item.Url == url);
        return original.Url is null || Deleted.Contains(url)
            ? null
            : await SaveAsync(original.Data, original.ContentType, cancellationToken);
    }

    // A picture this store saved and hasn't deleted.
    public Task<ReadOnlyMemory<byte>?> LoadAsync(string url, CancellationToken cancellationToken)
    {
        var saved = Saved.Find(item => item.Url == url);
        // A plain null would become an empty picture, by the conversion from an array.
        return Task.FromResult(
            saved.Url is null || Deleted.Contains(url) ? (ReadOnlyMemory<byte>?)null : saved.Data);
    }

    public Task DeleteAsync(string url, CancellationToken cancellationToken)
    {
        Deleted.Add(url);
        return DeleteFailure is null ? Task.CompletedTask : Task.FromException(DeleteFailure);
    }
}
