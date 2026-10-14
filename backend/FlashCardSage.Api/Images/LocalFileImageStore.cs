using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Images;

// Keeps pictures as files in a folder, which Program.cs serves on /card-images, for local development and E2E
// tests, where there's no storage account. A picture's URL is on the API's own address, as the browser sees it, or
// outside a request (the built-in cards' pictures, saved when the API starts) on the address the server listens on.
public partial class LocalFileImageStore(
    IOptions<ImageStoreOptions> options,
    IHostEnvironment environment,
    IHttpContextAccessor httpContextAccessor,
    IServer server) : IImageStore
{
    // Where the files are, as a full path: LocalPath under the content root, or LocalPath itself when it's absolute.
    public string Directory { get; } =
        Path.GetFullPath(options.Value.LocalPath, environment.ContentRootPath);

    public async Task<string> SaveAsync(ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken)
    {
        var url = BaseUrl();
        var name = CardImage.NewName(contentType);
        await File.WriteAllBytesAsync(Path.Join(Directory, name), data, cancellationToken);
        return $"{url}/{name}";
    }

    public async Task<string> SaveAsync(string name, ReadOnlyMemory<byte> data, CancellationToken cancellationToken)
    {
        var url = BaseUrl();
        var path = Path.Join(Directory, name);
        if (!File.Exists(path))
        {
            await File.WriteAllBytesAsync(path, data, cancellationToken);
        }

        return $"{url}/{name}";
    }

    public async Task<string?> CopyAsync(string url, CancellationToken cancellationToken)
    {
        if (FileName(url) is not { } name)
        {
            return null;
        }

        byte[] data;
        try
        {
            data = await File.ReadAllBytesAsync(Path.Join(Directory, name), cancellationToken);
        }
        catch (FileNotFoundException)
        {
            return null;
        }

        return await SaveAsync(data, CardImage.ContentTypeOf(name), cancellationToken);
    }

    public async Task DeleteAsync(string url, CancellationToken cancellationToken)
    {
        if (FileName(url) is not { } name)
        {
            return;
        }

        // On Windows the file can't be deleted while it's still being sent to a browser, which doesn't last long.
        var path = Path.Join(Directory, name);
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

    // Where the pictures are served: on the request's address, or outside a request on the first address the server
    // listens on, with localhost for one that means any address (http://+:5269, say).
    private string BaseUrl()
    {
        if (httpContextAccessor.HttpContext?.Request is { } request)
        {
            return $"{request.Scheme}://{request.Host}{ImageStoreOptions.LocalRequestPath}";
        }

        var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault()
            ?? throw new InvalidOperationException("A picture can only be saved while handling a request or listening.");
        return AnyHost().Replace(address.TrimEnd('/'), "://localhost") + ImageStoreOptions.LocalRequestPath;
    }

    // The name of this store's picture at the URL, or null when it isn't one. A picture is this store's by its path,
    // whatever the address, since the API may have been reached on another one (127.0.0.1, say) when the picture was
    // saved.
    private static string? FileName(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || !uri.AbsolutePath.StartsWith(ImageStoreOptions.LocalRequestPath + "/", StringComparison.Ordinal))
        {
            return null;
        }

        var name = uri.AbsolutePath[(ImageStoreOptions.LocalRequestPath.Length + 1)..];
        return CardImage.IsName(name) ? name : null;
    }

    private const int DeleteAttempts = 5;

    private static readonly TimeSpan DeleteRetryDelay = TimeSpan.FromMilliseconds(100);

    [GeneratedRegex(@"://(\+|\*|\[::\]|0\.0\.0\.0)(?=[:/]|$)")]
    private static partial Regex AnyHost();
}
