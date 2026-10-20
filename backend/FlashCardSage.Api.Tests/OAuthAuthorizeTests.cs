using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.OAuth;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace FlashCardSage.Api.Tests;

public class OAuthAuthorizeTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    private const string ClaudeCallback = "https://claude.ai/api/mcp/auth_callback";

    [Fact]
    public async Task MetadataDocumentClient_IsFetched_AndShownByItsHost()
    {
        var clientId = MetadataDocumentUrl();
        var handler = MetadataDocument(clientId);
        using var app = CreateApp(handler);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var (verifier, challenge) = OAuthFlow.PkcePair();

        var requestId = await OAuthFlow.BeginAsync(anonymous, clientId, ClaudeCallback, challenge);

        var request = await user.GetFromJsonAsync<OAuthAuthorizationRequestResponse>(
            $"/api/oauth/authorizations/{requestId}");
        Assert.Equal("Claude", request!.ClientName);
        Assert.Equal("claude.ai", request.ClientHost);
        Assert.False(request.ClientNameIsSelfAsserted);
        Assert.Equal("claude.ai", request.RedirectHost);
        Assert.Equal(["flashcards"], request.Scopes);
        var redirect = await OAuthFlow.ApproveAsync(user, requestId);
        Assert.StartsWith($"{ClaudeCallback}?code=", redirect.ToString(), StringComparison.Ordinal);
        await OAuthFlow.ReadTokensAsync(await OAuthFlow.ExchangeAsync(
            anonymous, OAuthFlow.Query(redirect)["code"], clientId, ClaudeCallback, verifier));
        var fetched = Assert.Single(handler.Requests);
        Assert.Equal(clientId, fetched.Url);
    }

    [Fact]
    public async Task MetadataDocumentClient_IsRefused_WhenTheDocumentNamesAnotherClient()
    {
        var clientId = MetadataDocumentUrl();
        using var app = CreateApp(MetadataDocument(clientId, documentClientId: MetadataDocumentUrl()));
        using var anonymous = OAuthFlow.CreateClient(app);

        var response = await OAuthFlow.AuthorizeAsync(
            anonymous, OAuthFlow.AuthorizeQuery(clientId, ClaudeCallback, OAuthFlow.PkcePair().Challenge));

        Assert.Equal($"{OAuthFlow.FrontendAuthorizeUrl}?error=invalid_client", OAuthFlow.Location(response).ToString());
    }

    [Fact]
    public async Task UnknownClient_GoesToTheFrontend_NotTheRedirectUri()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);

        var response = await OAuthFlow.AuthorizeAsync(
            anonymous, OAuthFlow.AuthorizeQuery("fcs_c_unknown", "https://app.example/cb", OAuthFlow.PkcePair().Challenge));

        Assert.Equal($"{OAuthFlow.FrontendAuthorizeUrl}?error=invalid_client", OAuthFlow.Location(response).ToString());
    }

    [Fact]
    public async Task UnregisteredRedirectUri_GoesToTheFrontend_NotTheRedirectUri()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        var clientId = await OAuthFlow.RegisterAsync(anonymous, "https://app.example/cb");

        var response = await OAuthFlow.AuthorizeAsync(
            anonymous, OAuthFlow.AuthorizeQuery(clientId, "https://evil.example/cb", OAuthFlow.PkcePair().Challenge));

        Assert.Equal(
            $"{OAuthFlow.FrontendAuthorizeUrl}?error=invalid_redirect_uri", OAuthFlow.Location(response).ToString());
    }

    [Theory]
    [InlineData("http://127.0.0.1/callback", "http://127.0.0.1:53111/callback", true)]
    [InlineData("http://localhost:8080/callback", "http://localhost:9999/callback", true)]
    [InlineData("http://[::1]/callback", "http://[::1]:4000/callback", true)]
    [InlineData("https://app.example/cb", "https://app.example:8443/cb", false)]
    public async Task RedirectUri_OnLoopback_MatchesOnAnyPort(string registered, string requested, bool matches)
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        var clientId = await OAuthFlow.RegisterAsync(anonymous, registered);

        var response = await OAuthFlow.AuthorizeAsync(
            anonymous, OAuthFlow.AuthorizeQuery(clientId, requested, OAuthFlow.PkcePair().Challenge));

        var location = OAuthFlow.Location(response).ToString();
        if (matches)
        {
            OAuthFlow.RequestId(response);
        }
        else
        {
            Assert.Equal($"{OAuthFlow.FrontendAuthorizeUrl}?error=invalid_redirect_uri", location);
        }
    }

    [Theory]
    [InlineData("code_challenge", null, "invalid_request")]
    [InlineData("code_challenge_method", null, "invalid_request")]
    [InlineData("code_challenge_method", "plain", "invalid_request")]
    [InlineData("code_challenge", "too-short", "invalid_request")]
    [InlineData("response_type", "token", "unsupported_response_type")]
    [InlineData("scope", "flashcards admin", "invalid_scope")]
    [InlineData("resource", "https://elsewhere.example/mcp", "invalid_target")]
    public async Task BadRequest_GoesBackToTheApp_WithTheErrorAndState(string parameter, string? value, string error)
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var query = OAuthFlow.AuthorizeQuery(clientId, OAuthFlow.LoopbackRedirectUri, OAuthFlow.PkcePair().Challenge);
        query[parameter] = value;

        var location = OAuthFlow.Location(await OAuthFlow.AuthorizeAsync(anonymous, query));

        Assert.StartsWith($"{OAuthFlow.LoopbackRedirectUri}?", location.ToString(), StringComparison.Ordinal);
        var parameters = OAuthFlow.Query(location);
        Assert.Equal(error, parameters["error"]);
        Assert.Equal(OAuthFlow.State, parameters["state"]);
        Assert.DoesNotContain("code", parameters.Keys);
    }

    [Theory]
    [InlineData("flashcards offline_access")]
    [InlineData("offline_access")]
    [InlineData(null)]
    public async Task Scope_LeavesOutOfflineAccess_AndDefaultsToFlashcards(string? scope)
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var query = OAuthFlow.AuthorizeQuery(clientId, OAuthFlow.LoopbackRedirectUri, OAuthFlow.PkcePair().Challenge);
        query["scope"] = scope;

        var requestId = OAuthFlow.RequestId(await OAuthFlow.AuthorizeAsync(anonymous, query));

        var request = await user.GetFromJsonAsync<OAuthAuthorizationRequestResponse>(
            $"/api/oauth/authorizations/{requestId}");
        Assert.Equal(["flashcards"], request!.Scopes);
    }

    [Fact]
    public async Task Approve_SendsTheAppTheCodeAndItsState_AndConnectsTheApproverOnly()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var alice = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        using var bob = OAuthFlow.CreateClient(app, $"test:Bob {Guid.NewGuid()}");
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var requestId = await OAuthFlow.BeginAsync(
            anonymous, clientId, "http://127.0.0.1:53111/callback", OAuthFlow.PkcePair().Challenge);

        var redirect = await OAuthFlow.ApproveAsync(alice, requestId);

        Assert.StartsWith("http://127.0.0.1:53111/callback?code=", redirect.ToString(), StringComparison.Ordinal);
        var parameters = OAuthFlow.Query(redirect);
        Assert.StartsWith(OAuthTokens.CodePrefix, parameters["code"], StringComparison.Ordinal);
        Assert.Equal(OAuthFlow.State, parameters["state"]);
        Assert.Single((await alice.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
        Assert.Empty((await bob.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
    }

    [Fact]
    public async Task Approve_IsNotFound_WhenTheRequestWasApprovedAlready()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var requestId = await OAuthFlow.BeginAsync(
            anonymous, clientId, OAuthFlow.LoopbackRedirectUri, OAuthFlow.PkcePair().Challenge);
        await OAuthFlow.ApproveAsync(user, requestId);

        var again = await user.PostAsync($"/api/oauth/authorizations/{requestId}/approve", null);

        Assert.Equal(HttpStatusCode.NotFound, again.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync($"/api/oauth/authorizations/{requestId}")).StatusCode);
    }

    [Fact]
    public async Task Deny_SendsTheAppAccessDenied_AndForgetsTheRequest()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        using var user = OAuthFlow.CreateClient(app, $"test:Alice {Guid.NewGuid()}");
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var requestId = await OAuthFlow.BeginAsync(
            anonymous, clientId, OAuthFlow.LoopbackRedirectUri, OAuthFlow.PkcePair().Challenge);

        var response = await user.PostAsync($"/api/oauth/authorizations/{requestId}/deny", null);

        var redirect = await response.Content.ReadFromJsonAsync<OAuthRedirectResponse>();
        var parameters = OAuthFlow.Query(new Uri(redirect!.RedirectUrl));
        Assert.Equal("access_denied", parameters["error"]);
        Assert.Equal(OAuthFlow.State, parameters["state"]);
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync($"/api/oauth/authorizations/{requestId}")).StatusCode);
        Assert.Empty((await user.GetFromJsonAsync<List<OAuthConnectionResponse>>("/api/oauth/connections"))!);
    }

    [Fact]
    public async Task GetAuthorization_NeedsASignedInUser()
    {
        using var app = TestApp.CreateFactory(factory);
        using var anonymous = OAuthFlow.CreateClient(app);
        var clientId = await OAuthFlow.RegisterAsync(anonymous);
        var requestId = await OAuthFlow.BeginAsync(
            anonymous, clientId, OAuthFlow.LoopbackRedirectUri, OAuthFlow.PkcePair().Challenge);

        Assert.Equal(
            HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/oauth/authorizations/{requestId}")).StatusCode);
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await anonymous.PostAsync($"/api/oauth/authorizations/{requestId}/approve", null)).StatusCode);
    }

    [Fact]
    public async Task GetAuthorization_IsNotFound_ForAnUnknownRequest()
    {
        using var client = TestApp.CreateSignedInClient(factory);

        var response = await client.GetAsync($"/api/oauth/authorizations/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task PendingRequest_Expires()
    {
        await using var server = new OAuthTestServer();
        var requestId = await server.BeginAsync(await server.RegisterAsync(), OAuthFlow.PkcePair().Challenge);

        server.Time.Advance(OAuthServerOptions.PendingRequestLifetime - TimeSpan.FromSeconds(1));
        Assert.NotNull(await server.Authorizations.GetPendingAsync(requestId, CancellationToken.None));
        server.Time.Advance(TimeSpan.FromSeconds(1));
        Assert.Null(await server.Authorizations.GetPendingAsync(requestId, CancellationToken.None));
        Assert.Null(await server.Authorizations.ApproveAsync(requestId, CancellationToken.None));
    }

    // A copy of the app that fetches client metadata documents from the handler.
    private WebApplicationFactory<Program> CreateApp(HttpMessageHandler handler)
    {
        return TestApp.CreateFactory(
            factory,
            services: services => services.AddHttpClient<ClientMetadataFetcher>()
                .ConfigurePrimaryHttpMessageHandler(() => handler));
    }

    // A URL of its own for each test, since the app keeps a fetched document for an hour.
    private static string MetadataDocumentUrl()
    {
        return $"https://claude.ai/oauth/{Guid.NewGuid()}/client-metadata.json";
    }

    private static RecordingHttpHandler MetadataDocument(string clientId, string? documentClientId = null)
    {
        return new RecordingHttpHandler(
            HttpStatusCode.OK,
            JsonSerializer.Serialize(new
            {
                client_id = documentClientId ?? clientId,
                client_name = "Claude",
                redirect_uris = new[] { ClaudeCallback },
                token_endpoint_auth_method = "none"
            }));
    }
}
