namespace FlashCardSage.Api.Images;

// Keeps cards' pictures somewhere a browser can load them from by URL.
public interface IImageStore
{
    // Keeps a picture under a new name and returns its public URL.
    Task<string> SaveAsync(ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken);

    // Keeps a picture under this name (one CardImage.IsName accepts, whose extension says its kind) and returns its
    // public URL. A picture that's already there under the name is left as it is, so the name should come from the
    // picture's content (see CardImage.ContentName).
    Task<string> SaveAsync(string name, ReadOnlyMemory<byte> data, CancellationToken cancellationToken);

    // Copies a picture, by the URL SaveAsync gave it, to a new name, and returns the copy's URL, so two cards never
    // share a picture (deleting one card's would take it from the other). Null when the URL isn't this store's or the
    // picture is gone.
    Task<string?> CopyAsync(string url, CancellationToken cancellationToken);

    // The picture at the URL SaveAsync gave it. Null when the URL isn't this store's or the picture is gone.
    Task<ReadOnlyMemory<byte>?> LoadAsync(string url, CancellationToken cancellationToken);

    // Removes a picture by the URL SaveAsync gave it. A URL that isn't this store's, or a picture that's already
    // gone, is left alone.
    Task DeleteAsync(string url, CancellationToken cancellationToken);
}
