using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.OAuth;

// What an app's client ID metadata document says about it.
public record ClientMetadata(string? Name, IReadOnlyList<string> RedirectUris);

/// <summary>
/// Fetches the document an app's client ID points at (OAuth Client ID Metadata Documents), as Claude's MCP client
/// signs in with: the app is whoever controls that URL. A typed HttpClient with a short timeout that doesn't follow
/// redirects, so the document is the one at that exact URL.
/// </summary>
public class ClientMetadataFetcher(HttpClient httpClient, ILogger<ClientMetadataFetcher> logger)
{
    public const int MaxBytes = 64 * 1024;

    // Whether the client ID is a URL the API would fetch a document from: https, on a named host that isn't this
    // computer, with a path.
    public static bool IsMetadataDocumentUrl(string? clientId)
    {
        return clientId is { Length: <= OAuthClient.MaxClientIdLength }
            && Uri.TryCreate(clientId, UriKind.Absolute, out var uri)
            && uri.Scheme == Uri.UriSchemeHttps
            && uri.HostNameType == UriHostNameType.Dns
            && !string.Equals(uri.Host, "localhost", StringComparison.OrdinalIgnoreCase)
            && !uri.Host.EndsWith(".localhost", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrEmpty(uri.Fragment)
            && uri.AbsolutePath.Length > 1;
    }

    // The app's metadata, or null when the document can't be fetched or isn't one the API accepts.
    public async Task<ClientMetadata?> FetchAsync(string clientId, CancellationToken cancellationToken)
    {
        if (!IsMetadataDocumentUrl(clientId))
        {
            return null;
        }

        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, clientId);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
            using var response = await httpClient.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);

            if (response.StatusCode != HttpStatusCode.OK)
            {
                logger.LogWarning("A client metadata document answered {StatusCode}", (int)response.StatusCode);
                return null;
            }

            if (response.Content.Headers.ContentLength > MaxBytes)
            {
                logger.LogWarning("A client metadata document was too big");
                return null;
            }

            var body = await ReadCappedAsync(response.Content, cancellationToken);
            if (body is null)
            {
                logger.LogWarning("A client metadata document was too big");
                return null;
            }

            return Parse(clientId, body);
        }
        catch (Exception exception) when ((exception is HttpRequestException or TaskCanceledException)
            && !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(exception, "Couldn't fetch a client metadata document");
            return null;
        }
    }

    private ClientMetadata? Parse(string clientId, byte[] body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            var root = document.RootElement;

            // The document must name itself, so a document can't be passed off as another app's.
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("client_id", out var documentClientId)
                || documentClientId.ValueKind != JsonValueKind.String
                || !string.Equals(documentClientId.GetString(), clientId, StringComparison.Ordinal))
            {
                logger.LogWarning("A client metadata document's client_id isn't its URL");
                return null;
            }

            // A public client, like every app here: it can't keep a secret.
            if (root.TryGetProperty("token_endpoint_auth_method", out var authMethod)
                && !(authMethod.ValueKind == JsonValueKind.String && authMethod.GetString() == "none"))
            {
                logger.LogWarning("A client metadata document asks for a token endpoint auth method other than none");
                return null;
            }

            if (!root.TryGetProperty("redirect_uris", out var redirectUris)
                || redirectUris.ValueKind != JsonValueKind.Array)
            {
                logger.LogWarning("A client metadata document has no redirect_uris");
                return null;
            }

            List<string> uris = [];
            foreach (var item in redirectUris.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String || !RedirectUris.IsAcceptable(item.GetString()))
                {
                    logger.LogWarning("A client metadata document has a redirect URI the API doesn't accept");
                    return null;
                }

                uris.Add(item.GetString()!);
            }

            if (uris.Count == 0)
            {
                logger.LogWarning("A client metadata document has no redirect_uris");
                return null;
            }

            var name = root.TryGetProperty("client_name", out var clientName) && clientName.ValueKind == JsonValueKind.String
                ? clientName.GetString()
                : null;

            return new ClientMetadata(Truncate(name?.Trim(), OAuthClient.MaxNameLength), uris);
        }
        catch (JsonException exception)
        {
            logger.LogWarning(exception, "A client metadata document isn't JSON");
            return null;
        }
    }

    // The body, or null when it's longer than MaxBytes, which is only read as far as that.
    private static async Task<byte[]?> ReadCappedAsync(HttpContent content, CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[8192];
        int read;
        while ((read = await stream.ReadAsync(chunk, cancellationToken)) > 0)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > MaxBytes)
            {
                return null;
            }
        }

        return buffer.ToArray();
    }

    private static string? Truncate(string? value, int maxLength)
    {
        return string.IsNullOrEmpty(value) ? null : value[..Math.Min(value.Length, maxLength)];
    }
}
