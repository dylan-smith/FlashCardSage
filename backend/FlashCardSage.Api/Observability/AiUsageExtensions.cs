using System.Globalization;

namespace FlashCardSage.Api.Observability;

public static class AiUsageExtensions
{
    // Sends a request to an AI model, and records it as a failed call if no answer comes: the service can't be
    // reached, or it's slower than the client's timeout. A request the caller cancels isn't recorded, since the user
    // just stopped waiting for it. The caller records the answer.
    public static async Task<HttpResponseMessage> SendAsync(
        this IAiUsage aiUsage,
        HttpClient httpClient,
        HttpRequestMessage request,
        Func<AiGeneration> generation,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(aiUsage);
        ArgumentNullException.ThrowIfNull(httpClient);
        ArgumentNullException.ThrowIfNull(generation);
        try
        {
            return await httpClient.SendAsync(request, cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            aiUsage.Record(generation() with { Error = ex.Message });
            throw;
        }
        catch (TaskCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            var timeout = httpClient.Timeout.TotalSeconds.ToString("0.##", CultureInfo.InvariantCulture);
            aiUsage.Record(generation() with { Error = $"No answer within {timeout} seconds." });
            throw;
        }
    }
}
