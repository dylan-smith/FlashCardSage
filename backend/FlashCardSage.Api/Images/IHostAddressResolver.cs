using System.Net;

namespace FlashCardSage.Api.Images;

// Looks up the addresses a host name stands for, so RemotePictureFetcher can check where a URL really leads (and the
// tests can say what a name resolves to without DNS).
public interface IHostAddressResolver
{
    Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken);
}

// Asks DNS.
public sealed class DnsHostAddressResolver : IHostAddressResolver
{
    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken)
    {
        return Dns.GetHostAddressesAsync(host, cancellationToken);
    }
}
