namespace FlashCardSage.Api.Tests.Fakes;

// Stands in for an HTTP service that never answers, so every request times out or is cancelled.
internal sealed class SlowHttpHandler : HttpMessageHandler
{
    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        await Task.Delay(Timeout.Infinite, cancellationToken);
        throw new InvalidOperationException("Unreachable.");
    }
}
