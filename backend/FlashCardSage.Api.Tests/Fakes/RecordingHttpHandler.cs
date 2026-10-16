using System.Net;
using System.Text;

namespace FlashCardSage.Api.Tests.Fakes;

// Stands in for an HTTP service: answers each request by its URL, and keeps what was sent.
internal sealed class RecordingHttpHandler(Func<string, (HttpStatusCode Status, string Body)> respond) : HttpMessageHandler
{
    // Answers every request the same way.
    public RecordingHttpHandler(HttpStatusCode status, string body)
        : this(_ => (status, body))
    {
    }

    public List<RecordedRequest> Requests { get; } = [];

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var url = request.RequestUri!.ToString();
        Requests.Add(new RecordedRequest(
            request.Method,
            url,
            request.Headers.ToDictionary(header => header.Key, header => string.Join(",", header.Value), StringComparer.OrdinalIgnoreCase),
            request.Content?.Headers.ContentType?.ToString(),
            request.Content?.Headers.ContentLength,
            request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
        var (status, body) = respond(url);
        return new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json")
        };
    }
}

// A request the handler was sent, with its headers, and its body as text.
internal sealed record RecordedRequest(
    HttpMethod Method,
    string Url,
    IReadOnlyDictionary<string, string> Headers,
    string? ContentType,
    long? ContentLength,
    string? Body)
{
    // The header's value, or null when it wasn't sent.
    public string? Header(string name)
    {
        return Headers.GetValueOrDefault(name);
    }
}
