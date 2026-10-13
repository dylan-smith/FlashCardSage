namespace FlashCardSage.Api.Images;

// Keeps cards' pictures somewhere a browser can load them from by URL.
public interface IImageStore
{
    // Keeps a picture under a new name and returns its public URL.
    Task<string> SaveAsync(ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken);

    // Removes a picture by the URL SaveAsync gave it. A URL that isn't this store's, or a picture that's already
    // gone, is left alone.
    Task DeleteAsync(string url, CancellationToken cancellationToken);
}
