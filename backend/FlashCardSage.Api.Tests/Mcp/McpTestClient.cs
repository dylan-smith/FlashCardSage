using System.Text.Json;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace FlashCardSage.Api.Tests.Mcp;

// Connects to the app's MCP endpoint as an MCP client would, over a test client that already sends a token.
internal static class McpTestClient
{
    public static Task<McpClient> ConnectAsync(HttpClient http)
    {
        ArgumentNullException.ThrowIfNull(http);

        var transport = new HttpClientTransport(
            new HttpClientTransportOptions
            {
                Endpoint = new Uri(http.BaseAddress!, "/mcp"),
                TransportMode = HttpTransportMode.StreamableHttp,
                // The endpoint is stateless, so there's no stream to listen on between requests.
                EnableStandaloneGetStream = false
            },
            http);

        return McpClient.CreateAsync(transport);
    }

    // Calls the tool, returning its text and whether it's an error.
    public static async Task<(string Text, bool IsError)> CallAsync(
        McpClient client, string tool, IReadOnlyDictionary<string, object?>? arguments = null)
    {
        ArgumentNullException.ThrowIfNull(client);

        var result = await client.CallToolAsync(tool, arguments ?? new Dictionary<string, object?>());
        var text = string.Concat(result.Content.OfType<TextContentBlock>().Select(block => block.Text));
        return (text, result.IsError is true);
    }

    // Calls the tool, which must succeed, returning its JSON result.
    public static async Task<JsonElement> CallJsonAsync(
        McpClient client, string tool, IReadOnlyDictionary<string, object?>? arguments = null)
    {
        var (text, isError) = await CallAsync(client, tool, arguments);
        Assert.False(isError, text);
        using var document = JsonDocument.Parse(text);
        return document.RootElement.Clone();
    }
}
