using System.Net;
using System.Net.Http.Headers;

namespace FlashCardSage.Api.Tests.Fakes;

// Stands in for the web servers pictures are downloaded from: answers each request by its URL with bytes, and keeps
// the requests sent.
internal sealed class StubPictureHandler(Func<Uri, CancellationToken, Task<HttpResponseMessage>> respond)
    : HttpMessageHandler
{
    // Answers each request by its URL.
    public StubPictureHandler(Func<Uri, HttpResponseMessage> respond)
        : this((url, _) => Task.FromResult(respond(url)))
    {
    }

    public List<HttpRequestMessage> Requests { get; } = [];

    public IEnumerable<Uri> Urls => Requests.Select(request => request.RequestUri!);

    // An answer with these bytes as a body of this content type.
    public static HttpResponseMessage Picture(byte[] bytes, string contentType)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
    }

    // A redirect to the location, absolute or relative.
    public static HttpResponseMessage Redirect(string location, HttpStatusCode status = HttpStatusCode.Found)
    {
        var response = new HttpResponseMessage(status);
        response.Headers.Location = new Uri(location, UriKind.RelativeOrAbsolute);
        return response;
    }

    protected override Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        Requests.Add(request);
        return respond(request.RequestUri!, cancellationToken);
    }
}

// A body that doesn't say how long it is (no Content-Length), as a streamed answer might.
internal sealed class UnknownLengthContent : HttpContent
{
    private readonly byte[] bytes;

    public UnknownLengthContent(byte[] bytes, string contentType)
    {
        this.bytes = bytes;
        Headers.ContentType = new MediaTypeHeaderValue(contentType);
    }

    protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context)
    {
        return stream.WriteAsync(bytes).AsTask();
    }

    protected override bool TryComputeLength(out long length)
    {
        length = 0;
        return false;
    }
}
