using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Images;

// Keeps pictures as blobs in a public container, so a browser loads them straight from storage.
public class BlobImageStore(IOptions<ImageStoreOptions> options) : ImageStoreBase
{
    private readonly BlobContainerClient container =
        new(options.Value.StorageConnectionString, options.Value.ContainerName);

    public override async Task DeleteAsync(string url, CancellationToken cancellationToken)
    {
        if (NameFromUrl(url) is { } name)
        {
            await container.GetBlobClient(name).DeleteIfExistsAsync(cancellationToken: cancellationToken);
        }
    }

    protected override async Task<ReadOnlyMemory<byte>?> ReadAsync(string name, CancellationToken cancellationToken)
    {
        try
        {
            var download = await container.GetBlobClient(name).DownloadContentAsync(cancellationToken);
            return download.Value.Content.ToMemory();
        }
        catch (RequestFailedException ex) when (ex.Status == StatusCodes.Status404NotFound)
        {
            return null;
        }
    }

    protected override async Task WriteAsync(
        string name, ReadOnlyMemory<byte> data, bool overwrite, CancellationToken cancellationToken)
    {
        var upload = UploadOptions(CardImage.ContentTypeOf(name));
        if (!overwrite)
        {
            upload.Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All };
        }

        try
        {
            await container.GetBlobClient(name).UploadAsync(BinaryData.FromBytes(data), upload, cancellationToken);
        }
        catch (RequestFailedException ex) when (!overwrite && ex.Status == StatusCodes.Status409Conflict)
        {
            // It's there already.
        }
    }

    protected override string UrlFor(string name)
    {
        return container.GetBlobClient(name).Uri.AbsoluteUri;
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

    protected override string? NameFromUrl(string url)
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
