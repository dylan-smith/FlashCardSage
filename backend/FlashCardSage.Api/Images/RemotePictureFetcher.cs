using System.Net;
using System.Net.Sockets;

namespace FlashCardSage.Api.Images;

/// <summary>
/// Downloads a picture from an https URL the user gave, for a card.
/// </summary>
/// <remarks>
/// The URL comes from the user (or an assistant acting for them), so the download must not become a way into the
/// API's own network: the cloud metadata endpoint, the database, or anything else only reachable from inside. Every
/// URL, and every redirect, must be https to a host whose addresses are all public, and the connection itself
/// (CreateHandler) looks the host up again and refuses anything else, so a name that resolves somewhere public for
/// the check and somewhere private for the connection gets nowhere. The answer must be a JPEG, PNG or WebP within
/// CardImage.MaxBytes. The URL is the user's own data, so only status codes and byte counts are logged.
/// </remarks>
public class RemotePictureFetcher(
    HttpClient httpClient,
    IHostAddressResolver resolver,
    ILogger<RemotePictureFetcher> logger)
{
    // The longest a whole download can take, redirects and all (the typed client's timeout, which FetchAsync applies
    // to the body too).
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    // What the typed client says it is.
    public const string UserAgent = "FlashCardSage/1.0 (+https://flashcardsage.com)";

    // The most redirects followed for one picture.
    public const int MaxRedirects = 3;

    private const string NotPublicMessage = "The picture URL must be on the public internet.";

    // Downloads the picture at the URL, or says why not.
    public Task<RemotePictureResult> FetchAsync(string? url, CancellationToken cancellationToken)
    {
        return Uri.TryCreate(url, UriKind.Absolute, out var uri)
            ? FetchAsync(uri, cancellationToken)
            : Task.FromResult<RemotePictureResult>(
                new RemotePictureResult.Refused("The picture URL isn't a valid absolute URL."));
    }

    // Downloads the picture at the URL, or says why not. The host check sits right before the request it guards, for
    // the first URL and each redirect alike.
    public async Task<RemotePictureResult> FetchAsync(Uri url, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(url);

        // The client's timeout only covers the headers when the body is streamed, so the whole download gets its own.
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(httpClient.Timeout);
        var current = url;
        try
        {
            for (var redirects = 0; ; redirects++)
            {
                if (!current.IsAbsoluteUri || current.Scheme != Uri.UriSchemeHttps)
                {
                    return Refuse("The picture URL must start with https://.");
                }

                IPAddress[] addresses;
                if (current.HostNameType is UriHostNameType.IPv4 or UriHostNameType.IPv6)
                {
                    if (!IPAddress.TryParse(current.IdnHost, out var literal))
                    {
                        return Refuse(NotPublicMessage);
                    }

                    addresses = [literal];
                }
                else if (current.HostNameType is UriHostNameType.Dns)
                {
                    try
                    {
                        addresses = await resolver.ResolveAsync(current.IdnHost, deadline.Token);
                    }
                    catch (SocketException)
                    {
                        return Refuse("The picture URL's host can't be found.");
                    }
                }
                else
                {
                    return Refuse(NotPublicMessage);
                }

                if (addresses.Length == 0 || !addresses.All(IsPublicAddress))
                {
                    return Refuse(NotPublicMessage);
                }

                using var request = new HttpRequestMessage(HttpMethod.Get, current);
                request.Headers.Accept.ParseAdd("image/*");
                using var response = await httpClient.SendAsync(
                    request, HttpCompletionOption.ResponseHeadersRead, deadline.Token);

                if (IsRedirect(response.StatusCode))
                {
                    logger.LogInformation("Picture download redirected ({StatusCode})", (int)response.StatusCode);
                    if (response.Headers.Location is not { } location)
                    {
                        return Refuse("The picture URL redirected nowhere.");
                    }

                    if (redirects == MaxRedirects)
                    {
                        return Refuse("The picture URL redirected too many times.");
                    }

                    current = location.IsAbsoluteUri ? location : new Uri(current, location);
                    continue;
                }

                return await ReadPictureAsync(response, deadline.Token);
            }
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Picture download timed out");
            return Refuse("The picture took too long to download.");
        }
        catch (HttpRequestException ex)
        {
            // The exception's message can name the host, so only the kind of error is logged.
            logger.LogWarning("Picture download failed ({HttpRequestError})", ex.HttpRequestError);
            return Refuse("The picture couldn't be downloaded.");
        }
    }

    // Whether an address is on the public internet: not loopback, private, link-local (which includes the cloud
    // metadata endpoint 169.254.169.254), shared (carrier-grade NAT), multicast, reserved or unspecified. An IPv4
    // address written as IPv6 is checked as IPv4.
    public static bool IsPublicAddress(IPAddress address)
    {
        ArgumentNullException.ThrowIfNull(address);

        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily == AddressFamily.InterNetwork)
        {
            var bytes = address.GetAddressBytes();
            return bytes switch
            {
                [0, ..] => false, // "This network", 0.0.0.0/8
                [10, ..] => false, // Private, 10.0.0.0/8
                [100, >= 64 and <= 127, ..] => false, // Shared (carrier-grade NAT), 100.64.0.0/10
                [127, ..] => false, // Loopback, 127.0.0.0/8
                [169, 254, ..] => false, // Link-local and cloud metadata, 169.254.0.0/16
                [172, >= 16 and <= 31, ..] => false, // Private, 172.16.0.0/12
                [192, 0, 0, _] => false, // IETF protocol assignments, 192.0.0.0/24
                [192, 168, ..] => false, // Private, 192.168.0.0/16
                [198, 18 or 19, ..] => false, // Benchmarking, 198.18.0.0/15
                [>= 224, ..] => false, // Multicast 224.0.0.0/4, reserved 240.0.0.0/4 and broadcast
                _ => true
            };
        }

        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            var bytes = address.GetAddressBytes();
            if (address.Equals(IPAddress.IPv6Any) || address.Equals(IPAddress.IPv6Loopback)
                || address.IsIPv6LinkLocal || address.IsIPv6SiteLocal || address.IsIPv6Multicast
                || (bytes[0] & 0xFE) == 0xFC) // Unique local, fc00::/7
            {
                return false;
            }

            // NAT64 (64:ff9b::/96) reaches the IPv4 address in its last four bytes.
            ReadOnlySpan<byte> nat64Prefix = [0x00, 0x64, 0xFF, 0x9B, 0, 0, 0, 0, 0, 0, 0, 0];
            return !bytes.AsSpan(0, 12).SequenceEqual(nat64Prefix)
                || IsPublicAddress(new IPAddress(bytes.AsSpan(12, 4)));
        }

        return false;
    }

    // The handler the typed client sends through: it doesn't follow redirects (FetchAsync checks each one first),
    // keeps no cookies, skips any proxy, and connects only to public addresses, looking the host up again itself.
    public static SocketsHttpHandler CreateHandler(IHostAddressResolver resolver)
    {
        ArgumentNullException.ThrowIfNull(resolver);

        return new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            UseProxy = false,
            ConnectCallback = (context, cancellationToken) =>
                ConnectToPublicAddressAsync(resolver, context, cancellationToken)
        };
    }

    // Opens the connection for a request, refusing a host with any address that isn't public. The addresses are the
    // ones connected to, so a DNS answer that changed since FetchAsync's check can't lead anywhere private.
    public static async ValueTask<Stream> ConnectToPublicAddressAsync(
        IHostAddressResolver resolver, SocketsHttpConnectionContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(resolver);
        ArgumentNullException.ThrowIfNull(context);

        var host = context.DnsEndPoint.Host;
        var addresses = IPAddress.TryParse(host, out var literal)
            ? [literal]
            : await resolver.ResolveAsync(host, cancellationToken);
        if (addresses.Length == 0 || !addresses.All(IsPublicAddress))
        {
            throw new HttpRequestException(HttpRequestError.ConnectionError, "The host isn't on the public internet.");
        }

        var socket = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await socket.ConnectAsync(addresses, context.DnsEndPoint.Port, cancellationToken);
            return new NetworkStream(socket, ownsSocket: true);
        }
        catch
        {
            socket.Dispose();
            throw;
        }
    }

    // Reads a picture from an answer that isn't a redirect, checking it on the way.
    private async Task<RemotePictureResult> ReadPictureAsync(
        HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning("Picture download answered {StatusCode}", (int)response.StatusCode);
            return Refuse($"The picture URL answered {(int)response.StatusCode}.");
        }

        var contentType = response.Content.Headers.ContentType?.MediaType;
        if (!CardImage.IsContentType(contentType))
        {
            return Refuse("The picture URL must lead to a JPEG, PNG or WebP picture.");
        }

        if (response.Content.Headers.ContentLength > CardImage.MaxBytes)
        {
            logger.LogWarning(
                "Picture download refused: {ByteCount} bytes is too big", response.Content.Headers.ContentLength);
            return Refuse(CardImage.TooBigMessage);
        }

        // Read in pieces and stop past the limit, since Content-Length can be missing or wrong.
        await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var picture = new MemoryStream();
        var buffer = new byte[81920];
        int read;
        while ((read = await body.ReadAsync(buffer, cancellationToken)) > 0)
        {
            if (picture.Length + read > CardImage.MaxBytes)
            {
                logger.LogWarning("Picture download refused: more than {ByteCount} bytes", CardImage.MaxBytes);
                return Refuse(CardImage.TooBigMessage);
            }

            picture.Write(buffer, 0, read);
        }

        var data = picture.ToArray();
        if (!CardImage.TryValidate(data, contentType, out var normalizedContentType, out var error))
        {
            return Refuse(error);
        }

        logger.LogInformation("Downloaded a picture of {ByteCount} bytes", data.Length);
        return new RemotePictureResult.Fetched(data, normalizedContentType);
    }

    private static bool IsRedirect(HttpStatusCode status)
    {
        return status is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther
            or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;
    }

    private static RemotePictureResult.Refused Refuse(string reason)
    {
        return new RemotePictureResult.Refused(reason);
    }
}
