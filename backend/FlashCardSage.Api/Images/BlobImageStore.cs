using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Images;

// Keeps pictures as blobs in a public container, so a browser loads them straight from storage.
public class BlobImageStore(IOptions<ImageStoreOptions> options) : IImageStore
{
    private readonly BlobContainerClient container =
        new(options.Value.StorageConnectionString, options.Value.ContainerName);

    public async Task<string> SaveAsync(ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken)
    {
        var blob = container.GetBlobClient(CardImage.NewName(contentType));
        await blob.UploadAsync(BinaryData.FromBytes(data), UploadOptions(contentType), cancellationToken);
        return blob.Uri.AbsoluteUri;
    }

    public async Task<string> SaveAsync(string name, ReadOnlyMemory<byte> data, CancellationToken cancellationToken)
    {
        var blob = container.GetBlobClient(name);
        var upload = UploadOptions(CardImage.ContentTypeOf(name));
        upload.Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All };
        try
        {
            await blob.UploadAsync(BinaryData.FromBytes(data), upload, cancellationToken);
        }
        catch (RequestFailedException ex) when (ex.Status == StatusCodes.Status409Conflict)
        {
            // It's there already.
        }

        return blob.Uri.AbsoluteUri;
    }

    // Downloads the picture and saves it again, rather than copying it in storage, so the copy is saved just as a new
    // picture is. A picture is at most a few megabytes.
    public async Task<string?> CopyAsync(string url, CancellationToken cancellationToken)
    {
        if (BlobName(url) is not { } name)
        {
            return null;
        }

        BlobDownloadResult download;
        try
        {
            download = (await container.GetBlobClient(name).DownloadContentAsync(cancellationToken)).Value;
        }
        catch (RequestFailedException ex) when (ex.Status == StatusCodes.Status404NotFound)
        {
            return null;
        }

        return await SaveAsync(download.Content.ToMemory(), CardImage.ContentTypeOf(name), cancellationToken);
    }

    public async Task DeleteAsync(string url, CancellationToken cancellationToken)
    {
        if (BlobName(url) is { } name)
        {
            await container.GetBlobClient(name).DeleteIfExistsAsync(cancellationToken: cancellationToken);
        }
    }

    // A picture never changes under its URL, so browsers can keep it for as long as they like.
    private static BlobUploadOptions UploadOptions(string contentType)
    {
        return new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders
            {
                ContentType = contentType,
                CacheControl = "public, max-age=31536000, immutable"
            }
        };
    }

    // The name of this store's picture at the URL, or null when it isn't one.
    private string? BlobName(string url)
    {
        ArgumentNullException.ThrowIfNull(url);
        var prefix = container.Uri.AbsoluteUri.TrimEnd('/') + "/";
        if (!url.StartsWith(prefix, StringComparison.Ordinal))
        {
            return null;
        }

        var name = url[prefix.Length..];
        return CardImage.IsName(name) ? name : null;
    }
}
