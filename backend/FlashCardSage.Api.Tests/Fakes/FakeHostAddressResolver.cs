using System.Net;
using System.Net.Sockets;
using FlashCardSage.Api.Images;

namespace FlashCardSage.Api.Tests.Fakes;

// Resolves host names from a list instead of DNS, and any name not on it to one public address. A name listed with no
// addresses can't be found.
internal sealed class FakeHostAddressResolver(IReadOnlyDictionary<string, string[]>? hosts = null) : IHostAddressResolver
{
    public const string PublicAddress = "93.184.216.34";

    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken)
    {
        var addresses = hosts?.GetValueOrDefault(host) ?? [PublicAddress];
        return addresses.Length == 0
            ? Task.FromException<IPAddress[]>(new SocketException((int)SocketError.HostNotFound))
            : Task.FromResult(addresses.Select(IPAddress.Parse).ToArray());
    }
}
