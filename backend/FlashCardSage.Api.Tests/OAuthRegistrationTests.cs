using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests;

public class OAuthRegistrationTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Register_CreatesAPublicClient()
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await RegisterAsync(client, """
            {
              "client_name": "  ChatGPT  ",
              "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
              "grant_types": ["authorization_code", "refresh_token"],
              "response_types": ["code"],
              "token_endpoint_auth_method": "none"
            }
            """);

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl!.ToString());
        var body = JsonNode.Parse(await response.Content.ReadAsStringAsync())!.AsObject();
        var clientId = body["client_id"]!.GetValue<string>();
        Assert.StartsWith(OAuthTokens.ClientIdPrefix, clientId, StringComparison.Ordinal);
        Assert.InRange(
            body["client_id_issued_at"]!.GetValue<long>(),
            DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds(),
            DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        body.Remove("client_id");
        body.Remove("client_id_issued_at");
        Assert.True(JsonNode.DeepEquals(
            JsonNode.Parse("""
                {
                  "client_name": "ChatGPT",
                  "redirect_uris": ["https://chatgpt.com/connector_platform_oauth_redirect"],
                  "token_endpoint_auth_method": "none",
                  "grant_types": ["authorization_code", "refresh_token"],
                  "response_types": ["code"]
                }
                """),
            body), body.ToJsonString());
    }

    [Fact]
    public async Task Register_LeavesOutTheName_WhenThereIsNone()
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await RegisterAsync(client, """{"redirect_uris":["http://127.0.0.1/callback"]}""");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(body.RootElement.TryGetProperty("client_name", out _));
    }

    [Theory]
    [InlineData("http://app.example/callback")]
    [InlineData("https://app.example/callback#fragment")]
    [InlineData("/callback")]
    [InlineData("javascript:alert(1)")]
    [InlineData("data:text/html,hi")]
    [InlineData("")]
    public async Task Register_RefusesARedirectUriThatCouldLeakTheCode(string redirectUri)
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await client.PostAsJsonAsync("/oauth/register", new { redirect_uris = new[] { redirectUri } });

        Assert.Equal(OAuthErrors.InvalidRedirectUri, await OAuthFlow.ReadErrorAsync(response));
    }

    [Fact]
    public async Task Register_NeedsARedirectUri()
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await client.PostAsJsonAsync("/oauth/register", new { client_name = "No redirect" });

        Assert.Equal(OAuthErrors.InvalidRedirectUri, await OAuthFlow.ReadErrorAsync(response));
    }

    [Theory]
    [InlineData("""{"redirect_uris":["http://127.0.0.1/cb"],"token_endpoint_auth_method":"client_secret_basic"}""")]
    [InlineData("""{"redirect_uris":["http://127.0.0.1/cb"],"grant_types":["client_credentials"]}""")]
    [InlineData("""{"redirect_uris":["http://127.0.0.1/cb"],"response_types":["token"]}""")]
    public async Task Register_RefusesAnythingButAPublicCodeFlowClient(string body)
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await RegisterAsync(client, body);

        Assert.Equal(OAuthErrors.InvalidClientMetadata, await OAuthFlow.ReadErrorAsync(response));
    }

    [Theory]
    [InlineData("POST", "/oauth/register")]
    [InlineData("POST", "/oauth/token")]
    [InlineData("GET", "/.well-known/oauth-authorization-server")]
    [InlineData("GET", "/.well-known/oauth-protected-resource/mcp")]
    public async Task PublicEndpoints_AllowAnyOrigin(string method, string path)
    {
        using var client = TestApp.CreateSignedOutClient(factory);
        using var preflight = new HttpRequestMessage(HttpMethod.Options, path);
        preflight.Headers.Add("Origin", "https://inspector.example");
        preflight.Headers.Add("Access-Control-Request-Method", method);
        preflight.Headers.Add("Access-Control-Request-Headers", "content-type");

        var response = await client.SendAsync(preflight);

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Equal("*", response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    private static async Task<HttpResponseMessage> RegisterAsync(HttpClient client, string json)
    {
        using var content = new StringContent(json, Encoding.UTF8, "application/json");
        return await client.PostAsync("/oauth/register", content);
    }
}
