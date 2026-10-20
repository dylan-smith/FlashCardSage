using System.Buffers.Text;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;

namespace FlashCardSage.Api.Tests;

// An app connected through the OAuth server: its client ID, the redirect URI it used, and the tokens it got.
internal sealed record ConnectedApp(string ClientId, string RedirectUri, OAuthTokenResponse Tokens);

// Drives the OAuth server over HTTP as an MCP client and the frontend's consent page would. The app's development
// settings put the API on http://localhost:5269 and the consent page on http://localhost:5173.
internal static class OAuthFlow
{
    public const string FrontendAuthorizeUrl = "http://localhost:5173/authorize";

    public const string McpResource = "http://localhost:5269/mcp";

    public const string LoopbackRedirectUri = "http://127.0.0.1/callback";

    public const string State = "state-123";

    // A client that doesn't follow redirects, so a test sees where the server sends the browser, sending the token
    // with every request when there is one.
    public static HttpClient CreateClient(WebApplicationFactory<Program> app, string? token = null)
    {
        ArgumentNullException.ThrowIfNull(app);

        var client = app.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    // A PKCE code verifier and its S256 challenge.
    public static (string Verifier, string Challenge) PkcePair()
    {
        var verifier = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32));
        return (verifier, Pkce.Challenge(verifier));
    }

    // Registers an app with these redirect URIs, returning its client ID.
    public static async Task<string> RegisterAsync(HttpClient client, params string[] redirectUris)
    {
        ArgumentNullException.ThrowIfNull(client);

        var response = await client.PostAsJsonAsync("/oauth/register", new
        {
            redirect_uris = redirectUris.Length == 0 ? [LoopbackRedirectUri] : redirectUris,
            client_name = "Test app",
            token_endpoint_auth_method = "none"
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("client_id").GetString()!;
    }

    // The query a good sign-in sends, for a test to change.
    public static Dictionary<string, string?> AuthorizeQuery(string clientId, string redirectUri, string challenge)
    {
        return new()
        {
            ["response_type"] = "code",
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["scope"] = OAuthServerOptions.Scope,
            ["state"] = State,
            ["code_challenge"] = challenge,
            ["code_challenge_method"] = Pkce.S256,
            ["resource"] = McpResource
        };
    }

    public static Task<HttpResponseMessage> AuthorizeAsync(HttpClient client, IDictionary<string, string?> query)
    {
        ArgumentNullException.ThrowIfNull(client);

        return client.GetAsync(QueryHelpers.AddQueryString(
            "/oauth/authorize", query.Where(parameter => parameter.Value is not null)));
    }

    // Where the server redirected to.
    public static Uri Location(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);

        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        return response.Headers.Location!;
    }

    // The ID of the sign-in the server sent the browser to the consent page with.
    public static Guid RequestId(HttpResponseMessage response)
    {
        var location = Location(response).ToString();
        Assert.StartsWith($"{FrontendAuthorizeUrl}?request=", location, StringComparison.Ordinal);
        return Guid.Parse(location[$"{FrontendAuthorizeUrl}?request=".Length..]);
    }

    // The query parameters of a URL.
    public static Dictionary<string, string> Query(Uri uri)
    {
        ArgumentNullException.ThrowIfNull(uri);

        return QueryHelpers.ParseQuery(uri.Query).ToDictionary(item => item.Key, item => item.Value.ToString());
    }

    // Starts a sign-in, returning its ID.
    public static async Task<Guid> BeginAsync(HttpClient client, string clientId, string redirectUri, string challenge)
    {
        return RequestId(await AuthorizeAsync(client, AuthorizeQuery(clientId, redirectUri, challenge)));
    }

    // Approves the sign-in as the signed-in user, returning where the consent page sends the browser.
    public static async Task<Uri> ApproveAsync(HttpClient user, Guid requestId)
    {
        ArgumentNullException.ThrowIfNull(user);

        var response = await user.PostAsync($"/api/oauth/authorizations/{requestId}/approve", null);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var redirect = await response.Content.ReadFromJsonAsync<OAuthRedirectResponse>();
        return new Uri(redirect!.RedirectUrl);
    }

    public static Task<HttpResponseMessage> TokenAsync(HttpClient client, Dictionary<string, string> form)
    {
        ArgumentNullException.ThrowIfNull(client);

        return client.PostAsync("/oauth/token", new FormUrlEncodedContent(form));
    }

    public static Task<HttpResponseMessage> ExchangeAsync(
        HttpClient client, string code, string clientId, string redirectUri, string verifier)
    {
        return TokenAsync(client, new()
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["client_id"] = clientId,
            ["redirect_uri"] = redirectUri,
            ["code_verifier"] = verifier,
            ["resource"] = McpResource
        });
    }

    public static Task<HttpResponseMessage> RefreshAsync(HttpClient client, string refreshToken, string clientId)
    {
        return TokenAsync(client, new()
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken,
            ["client_id"] = clientId
        });
    }

    // The tokens in a successful token response.
    public static async Task<OAuthTokenResponse> ReadTokensAsync(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<OAuthTokenResponse>())!;
    }

    // The error code in a 400 OAuth error response.
    public static async Task<string> ReadErrorAsync(HttpResponseMessage response)
    {
        ArgumentNullException.ThrowIfNull(response);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<OAuthErrorResponse>())!.Error;
    }

    // Registers an app, signs in through it as the user, approves, and redeems the code.
    public static async Task<ConnectedApp> ConnectAsync(
        HttpClient anonymous, HttpClient user, string redirectUri = LoopbackRedirectUri)
    {
        var clientId = await RegisterAsync(anonymous, redirectUri);
        var (verifier, challenge) = PkcePair();
        var requestId = await BeginAsync(anonymous, clientId, redirectUri, challenge);
        var redirect = await ApproveAsync(user, requestId);
        var tokens = await ReadTokensAsync(
            await ExchangeAsync(anonymous, Query(redirect)["code"], clientId, redirectUri, verifier));
        return new ConnectedApp(clientId, redirectUri, tokens);
    }
}
