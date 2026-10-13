using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Images;

// Keeps pictures as files in a folder, which Program.cs serves on /card-images, for local development and E2E
// tests, where there's no storage account. A picture's URL is on the API's own address, as the browser sees it.
public class LocalFileImageStore(
    IOptions<ImageStoreOptions> options,
    IHostEnvironment environment,
    IHttpContextAccessor httpContextAccessor) : IImageStore
{
    // Where the files are, as a full path.
    public string Directory { get; } =
        Path.GetFullPath(Path.Combine(environment.ContentRootPath, options.Value.LocalPath));

    public async Task<string> SaveAsync(ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken)
    {
        var request = httpContextAccessor.HttpContext?.Request
            ?? throw new InvalidOperationException("A picture can only be saved while handling a request.");
        var name = CardImage.NewName(contentType);
        await File.WriteAllBytesAsync(Path.Combine(Directory, name), data, cancellationToken);
        return $"{request.Scheme}://{request.Host}{ImageStoreOptions.LocalRequestPath}/{name}";
    }

    // A picture is this store's by its path, whatever the address, since the API may have been reached on another
    // one (127.0.0.1, say) when the picture was saved.
    public async Task DeleteAsync(string url, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || !uri.AbsolutePath.StartsWith(ImageStoreOptions.LocalRequestPath + "/", StringComparison.Ordinal))
        {
            return;
        }

        var name = uri.AbsolutePath[(ImageStoreOptions.LocalRequestPath.Length + 1)..];
        if (!CardImage.IsName(name))
        {
            return;
        }

        // On Windows the file can't be deleted while it's still being sent to a browser, which doesn't last long.
        var path = Path.Combine(Directory, name);
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                File.Delete(path);
                return;
            }
            catch (IOException) when (attempt < DeleteAttempts)
            {
                await Task.Delay(DeleteRetryDelay, cancellationToken);
            }
        }
    }

    private const int DeleteAttempts = 5;

    private static readonly TimeSpan DeleteRetryDelay = TimeSpan.FromMilliseconds(100);
}
