using System.Net;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.OAuth;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The OAuth server's services over an in-memory database of their own, as the test user, on a clock the test moves.
// For the tests that need time to pass, which the whole app can't do without moving it for every test.
internal sealed class OAuthTestServer : IAsyncDisposable
{
    public static readonly OAuthServerOptions Options = new()
    {
        ApiBaseUrl = "http://localhost:5269",
        FrontendBaseUrl = "http://localhost:5173"
    };

    private readonly HttpClient metadataClient;

    public OAuthTestServer(HttpMessageHandler? metadataHandler = null)
    {
        Db = TestDb.Create();
        metadataClient = new HttpClient(metadataHandler ?? new RecordingHttpHandler(HttpStatusCode.NotFound, string.Empty));
        Clients = new OAuthClientRegistry(
            Db,
            new ClientMetadataFetcher(metadataClient, NullLogger<ClientMetadataFetcher>.Instance),
            Time,
            NullLogger<OAuthClientRegistry>.Instance);
        Authorizations = new OAuthAuthorizationService(
            Db,
            Clients,
            Options,
            new CurrentUser { UserId = TestDb.UserId },
            Time,
            NullLogger<OAuthAuthorizationService>.Instance);
        Tokens = new OAuthTokenService(Db, Options, Time, NullLogger<OAuthTokenService>.Instance);
    }

    public FixedTimeProvider Time { get; } = new();

    public FlashCardDbContext Db { get; }

    public OAuthClientRegistry Clients { get; }

    public OAuthAuthorizationService Authorizations { get; }

    public OAuthTokenService Tokens { get; }

    // Registers an app with a loopback redirect URI, returning its client ID.
    public async Task<string> RegisterAsync()
    {
        var registration = await Clients.RegisterAsync(
            new OAuthClientRegistrationRequest { RedirectUris = [OAuthFlow.LoopbackRedirectUri] },
            CancellationToken.None);
        return registration.Client!.ClientId;
    }

    // Starts a sign-in for the app, returning its ID.
    public async Task<Guid> BeginAsync(string clientId, string challenge)
    {
        var location = await Authorizations.BeginAsync(
            new OAuthAuthorizeRequest
            {
                ResponseType = "code",
                ClientId = clientId,
                RedirectUri = OAuthFlow.LoopbackRedirectUri,
                CodeChallenge = challenge,
                CodeChallengeMethod = Pkce.S256
            },
            CancellationToken.None);
        Assert.StartsWith($"{OAuthFlow.FrontendAuthorizeUrl}?request=", location, StringComparison.Ordinal);
        return Guid.Parse(location[$"{OAuthFlow.FrontendAuthorizeUrl}?request=".Length..]);
    }

    // Registers an app and approves a sign-in for it as the test user, returning the code and what redeems it.
    public async Task<(string ClientId, string Code, string Verifier)> ApproveAsync()
    {
        var clientId = await RegisterAsync();
        var (verifier, challenge) = OAuthFlow.PkcePair();
        var redirect = await Authorizations.ApproveAsync(await BeginAsync(clientId, challenge), CancellationToken.None);
        return (clientId, OAuthFlow.Query(new Uri(redirect!))["code"], verifier);
    }

    public Task<OAuthTokenResult> ExchangeAsync(string code, string clientId, string verifier)
    {
        return Tokens.ExchangeCodeAsync(
            code, clientId, OAuthFlow.LoopbackRedirectUri, verifier, resource: null, CancellationToken.None);
    }

    public Task<OAuthTokenResult> RefreshAsync(string refreshToken, string clientId)
    {
        return Tokens.RefreshAsync(refreshToken, clientId, scope: null, resource: null, CancellationToken.None);
    }

    // An approved sign-in's tokens.
    public async Task<(string ClientId, OAuthTokenResponse Tokens)> ConnectAsync()
    {
        var (clientId, code, verifier) = await ApproveAsync();
        var result = await ExchangeAsync(code, clientId, verifier);
        return (clientId, result.Tokens!);
    }

    public async ValueTask DisposeAsync()
    {
        metadataClient.Dispose();
        await Db.DisposeAsync();
    }
}
