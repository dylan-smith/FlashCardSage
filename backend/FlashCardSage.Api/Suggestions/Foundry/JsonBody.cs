using System.Net.Http.Headers;
using System.Text.Json;

namespace FlashCardSage.Api.Suggestions.Foundry;

public static class JsonBody
{
    // A request body of the value as JSON. The Foundry APIs refuse a request without a Content-Length, so the body is
    // serialized up front rather than streamed (which JsonContent would send chunked).
    public static ByteArrayContent Create(object value)
    {
        var content = new ByteArrayContent(JsonSerializer.SerializeToUtf8Bytes(value));
        content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return content;
    }
}
