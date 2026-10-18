namespace FlashCardSage.Api.Images;

// The part of an image store that's the same wherever the pictures are kept: how a picture is named, saved and
// copied. A store says how to find a picture's name in its URL and its URL from its name, and how to read and write a
// picture by name.
public abstract class ImageStoreBase : IImageStore
{
    public async Task<string> SaveAsync(ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken)
    {
        var name = CardImage.NewName(contentType);
        var url = UrlFor(name);
        await WriteAsync(name, data, overwrite: true, cancellationToken);
        return url;
    }

    public async Task<string> SaveAsync(string name, ReadOnlyMemory<byte> data, CancellationToken cancellationToken)
    {
        var url = UrlFor(name);
        await WriteAsync(name, data, overwrite: false, cancellationToken);
        return url;
    }

    // Reads the picture and saves it again, rather than copying it in storage, so the copy is saved just as a new
    // picture is. A picture is at most a few megabytes.
    public async Task<string?> CopyAsync(string url, CancellationToken cancellationToken)
    {
        return NameFromUrl(url) is { } name && await ReadAsync(name, cancellationToken) is { } data
            ? await SaveAsync(data, CardImage.ContentTypeOf(name), cancellationToken)
            : null;
    }

    public abstract Task DeleteAsync(string url, CancellationToken cancellationToken);

    // The name of this store's picture at the URL, or null when it isn't one.
    protected abstract string? NameFromUrl(string url);

    // The picture with this name, or null when it's gone.
    protected abstract Task<ReadOnlyMemory<byte>?> ReadAsync(string name, CancellationToken cancellationToken);

    // Keeps the picture under this name. Without overwrite, a picture that's already there under the name is left as
    // it is.
    protected abstract Task WriteAsync(
        string name, ReadOnlyMemory<byte> data, bool overwrite, CancellationToken cancellationToken);

    // The public URL of the picture with this name.
    protected abstract string UrlFor(string name);
}
