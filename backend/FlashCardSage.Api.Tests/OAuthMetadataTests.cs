using System.Net;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests;

public class OAuthMetadataTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task AuthorizationServer_DescribesTheServer()
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await client.GetAsync("/.well-known/oauth-authorization-server");

        await AssertJsonAsync(
            response,
            """
            {
              "issuer": "http://localhost:5269",
              "authorization_endpoint": "http://localhost:5269/oauth/authorize",
              "token_endpoint": "http://localhost:5269/oauth/token",
              "registration_endpoint": "http://localhost:5269/oauth/register",
              "scopes_supported": ["flashcards"],
              "response_types_supported": ["code"],
              "response_modes_supported": ["query"],
              "grant_types_supported": ["authorization_code", "refresh_token"],
              "token_endpoint_auth_methods_supported": ["none"],
              "code_challenge_methods_supported": ["S256"],
              "client_id_metadata_document_supported": true
            }
            """);
    }

    [Theory]
    [InlineData("/.well-known/oauth-protected-resource")]
    [InlineData("/.well-known/oauth-protected-resource/mcp")]
    public async Task ProtectedResource_NamesTheMcpEndpointAndTheServer(string path)
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await client.GetAsync(path);

        await AssertJsonAsync(
            response,
            """
            {
              "resource": "http://localhost:5269/mcp",
              "authorization_servers": ["http://localhost:5269"],
              "scopes_supported": ["flashcards"],
              "bearer_methods_supported": ["header"]
            }
            """);
    }

    [Fact]
    public async Task Metadata_FollowsTheConfiguredUrl_WithoutATrailingSlash()
    {
        using var client = TestApp.CreateSignedOutClient(
            factory, new Dictionary<string, string> { ["Api:BaseUrl"] = "https://api.example/" });

        var response = await client.GetAsync("/.well-known/oauth-protected-resource");

        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.Equal("https://api.example/mcp", body["resource"]!.GetValue<string>());
        Assert.Equal("https://api.example", body["authorization_servers"]![0]!.GetValue<string>());
    }

    [Theory]
    [InlineData("GET", "/.well-known/oauth-authorization-server")]
    [InlineData("GET", "/.well-known/oauth-protected-resource")]
    [InlineData("GET", "/.well-known/oauth-protected-resource/mcp")]
    [InlineData("GET", "/oauth/authorize")]
    [InlineData("POST", "/oauth/token")]
    [InlineData("POST", "/oauth/register")]
    public async Task OAuthEndpoints_AreUnavailable_WhenTheUrlsArentSet(string method, string path)
    {
        using var client = TestApp.CreateSignedOutClient(
            factory, new Dictionary<string, string> { ["Api:BaseUrl"] = string.Empty, ["Frontend:BaseUrl"] = string.Empty });
        using var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (path == "/oauth/token")
        {
            request.Content = new FormUrlEncodedContent(new Dictionary<string, string> { ["grant_type"] = "refresh_token" });
        }
        else if (path == "/oauth/register")
        {
            request.Content = new StringContent("""{"redirect_uris":["http://127.0.0.1/cb"]}""", null, "application/json");
        }

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    private static async Task AssertJsonAsync(HttpResponseMessage response, string expected)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var actual = JsonNode.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(expected), actual), actual!.ToJsonString());
    }
}
