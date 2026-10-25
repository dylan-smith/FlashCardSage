using System.Net;
using System.Text;
using FlashCardSage.Api.Mcp;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests.Mcp;

// The MCP endpoint end to end: signing in, the tools it lists, and calls through the SDK's client.
public class McpServerTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    // Every tool the server offers. A new or renamed tool is added here, and gets tests of its own.
    private static readonly string[] ToolNames =
    [
        "add_cards_to_deck",
        "create_card",
        "create_cards",
        "create_deck",
        "create_tag",
        "delete_cards",
        "delete_deck",
        "delete_tag",
        "get_card",
        "get_counts",
        "get_deck",
        "get_practice_history",
        "get_practice_stats",
        "list_cards",
        "list_decks",
        "list_tags",
        "remove_cards_from_deck",
        "rename_deck",
        "rename_tag",
        "update_card"
    ];

    [Fact]
    public async Task Connect_GivesTheServersNameAndInstructions_AndListsEveryTool()
    {
        using var http = TestApp.CreateSignedInClient(factory);
        await using var client = await McpTestClient.ConnectAsync(http);

        var tools = await client.ListToolsAsync();

        Assert.Equal("FlashCardSage", client.ServerInfo?.Name);
        Assert.Equal(McpInstructions.Text, client.ServerInstructions);
        Assert.Equal(ToolNames, tools.Select(tool => tool.Name).Order(StringComparer.Ordinal));
        Assert.All(tools, tool => Assert.False(string.IsNullOrWhiteSpace(tool.Description), tool.Name));
        Assert.All(tools, tool => Assert.False(tool.ProtocolTool.Annotations?.OpenWorldHint, tool.Name));
        Assert.True(tools.Single(tool => tool.Name == "list_cards").ProtocolTool.Annotations?.ReadOnlyHint);
        Assert.True(tools.Single(tool => tool.Name == "delete_cards").ProtocolTool.Annotations?.DestructiveHint);
        Assert.False(tools.Single(tool => tool.Name == "create_card").ProtocolTool.Annotations?.DestructiveHint);
    }

    [Fact]
    public async Task CreateCard_ThenListCards_FindsIt_AndADuplicateIsAnError()
    {
        using var http = TestApp.CreateSignedInClient(factory);
        await using var client = await McpTestClient.ConnectAsync(http);
        var card = new Dictionary<string, object?> { ["spanish"] = new[] { "el gato" }, ["english"] = new[] { "the cat" } };

        var created = await McpTestClient.CallJsonAsync(client, "create_card", card);
        var page = await McpTestClient.CallJsonAsync(
            client, "list_cards", new Dictionary<string, object?> { ["search"] = "GATO" });
        var (duplicate, isError) = await McpTestClient.CallAsync(client, "create_card", card);

        var id = created.GetProperty("id").GetInt32();
        Assert.Equal(1, page.GetProperty("total").GetInt32());
        Assert.Equal(id, page.GetProperty("cards")[0].GetProperty("id").GetInt32());
        Assert.True(isError);
        Assert.Contains($"Add this translation to that card instead (card {id}).", duplicate, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Tools_OnlySeeTheSignedInUsersCards()
    {
        using var app = TestApp.CreateFactory(factory);
        using var aliceHttp = TestApp.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        await using var alice = await McpTestClient.ConnectAsync(aliceHttp);
        using var bobHttp = TestApp.CreateClient(app, $"test:Bob {Guid.NewGuid()}");
        await using var bob = await McpTestClient.ConnectAsync(bobHttp);

        var created = await McpTestClient.CallJsonAsync(
            alice,
            "create_card",
            new Dictionary<string, object?> { ["spanish"] = new List<string> { "el perro" }, ["english"] = new List<string> { "the dog" } });
        var bobsCards = await McpTestClient.CallJsonAsync(bob, "list_cards");
        var (text, isError) = await McpTestClient.CallAsync(
            bob, "get_card", new Dictionary<string, object?> { ["id"] = created.GetProperty("id").GetInt32() });

        Assert.Equal(0, bobsCards.GetProperty("total").GetInt32());
        Assert.True(isError);
        Assert.Contains(ToolErrors.CardNotFound, text, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Post_WithoutAToken_IsChallengedWithTheResourceMetadataUrl()
    {
        using var http = TestApp.CreateSignedOutClient(factory);

        using var response = await http.PostAsync("/mcp", InitializeRequest());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Contains(
            "Bearer resource_metadata=\"http://localhost:5269/.well-known/oauth-protected-resource/mcp\"",
            response.Headers.WwwAuthenticate.ToString(),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProtectedResourceMetadata_IsServedByTheMetadataController()
    {
        using var http = TestApp.CreateSignedOutClient(factory);

        var metadata = await http.GetStringAsync(new Uri("/.well-known/oauth-protected-resource/mcp", UriKind.Relative));

        Assert.Contains("\"resource\":\"http://localhost:5269/mcp\"", metadata, StringComparison.Ordinal);
        Assert.Contains("\"bearer_methods_supported\":[\"header\"]", metadata, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Post_FromABrowser_CanReadTheChallenge()
    {
        using var http = TestApp.CreateSignedOutClient(factory);
        using var request = new HttpRequestMessage(HttpMethod.Post, "/mcp") { Content = InitializeRequest() };
        request.Headers.Add("Origin", "https://inspector.example");

        using var response = await http.SendAsync(request);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("*", Assert.Single(response.Headers.GetValues("Access-Control-Allow-Origin")));
        Assert.Contains(
            "WWW-Authenticate",
            Assert.Single(response.Headers.GetValues("Access-Control-Expose-Headers")),
            StringComparison.Ordinal);
    }

    // The endpoint is stateless, so there's no stream to open with a GET.
    [Fact]
    public async Task Get_IsNotAllowed()
    {
        using var http = TestApp.CreateSignedInClient(factory);
        http.DefaultRequestHeaders.Accept.ParseAdd("text/event-stream");

        using var response = await http.GetAsync(new Uri("/mcp", UriKind.Relative));

        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }

    [Fact]
    public async Task OpenApi_LeavesOutTheMcpEndpoint()
    {
        using var http = TestApp.CreateSignedOutClient(factory);

        var document = await http.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("/api/flashcards", document, StringComparison.Ordinal);
        Assert.DoesNotContain("\"/mcp\"", document, StringComparison.Ordinal);
    }

    private static StringContent InitializeRequest()
    {
        return new StringContent(
            """{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}""",
            Encoding.UTF8,
            "application/json");
    }
}
