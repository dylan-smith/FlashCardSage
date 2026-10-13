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
        // A picture never changes under its URL, so browsers can keep it for as long as they like.
        var upload = new BlobUploadOptions
        {
            HttpHeaders = new BlobHttpHeaders
            {
                ContentType = contentType,
                CacheControl = "public, max-age=31536000, immutable"
            }
        };
        await blob.UploadAsync(BinaryData.FromBytes(data), upload, cancellationToken);
        return blob.Uri.AbsoluteUri;
    }

    public async Task DeleteAsync(string url, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(url);
        var prefix = container.Uri.AbsoluteUri.TrimEnd('/') + "/";
        if (!url.StartsWith(prefix, StringComparison.Ordinal))
        {
            return;
        }

        var name = url[prefix.Length..];
        if (CardImage.IsName(name))
        {
            await container.GetBlobClient(name).DeleteIfExistsAsync(cancellationToken: cancellationToken);
        }
    }
}
