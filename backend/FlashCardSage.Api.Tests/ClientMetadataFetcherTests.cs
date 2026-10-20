using System.Net;
using System.Text.Json;
using FlashCardSage.Api.OAuth;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class ClientMetadataFetcherTests
{
    private const string ClientId = "https://claude.ai/oauth/claude-code-client-metadata";

    private static readonly string[] RedirectUriList = ["http://localhost/callback", "http://127.0.0.1/callback"];

    private static readonly string[] GrantTypes = ["authorization_code", "refresh_token"];

    [Fact]
    public async Task Fetch_ReadsTheNameAndRedirectUris()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, Document());

        var metadata = await FetchAsync(handler);

        Assert.Equal("Claude Code", metadata!.Name);
        Assert.Equal(["http://localhost/callback", "http://127.0.0.1/callback"], metadata.RedirectUris);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("application/json", request.Header("Accept"));
    }

    [Theory]
    [InlineData("http://claude.ai/oauth/metadata")]
    [InlineData("https://127.0.0.1/oauth/metadata")]
    [InlineData("https://[::1]/oauth/metadata")]
    [InlineData("https://localhost/oauth/metadata")]
    [InlineData("https://app.localhost/oauth/metadata")]
    [InlineData("https://claude.ai")]
    [InlineData("https://claude.ai/")]
    [InlineData("fcs_c_abc")]
    public async Task Fetch_DoesntAsk_ForAClientIdThatIsntAPublicHttpsUrl(string clientId)
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, Document(clientId));
        using var httpClient = new HttpClient(handler);
        var fetcher = new ClientMetadataFetcher(httpClient, NullLogger<ClientMetadataFetcher>.Instance);

        Assert.Null(await fetcher.FetchAsync(clientId, CancellationToken.None));
        Assert.Empty(handler.Requests);
    }

    [Theory]
    [InlineData(HttpStatusCode.Found)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task Fetch_Refuses_AnythingButOk(HttpStatusCode status)
    {
        Assert.Null(await FetchAsync(new RecordingHttpHandler(status, Document())));
    }

    [Fact]
    public async Task Fetch_Refuses_ADocumentForAnotherClientId()
    {
        Assert.Null(await FetchAsync(new RecordingHttpHandler(
            HttpStatusCode.OK, Document("https://evil.example/oauth/metadata"))));
    }

    [Theory]
    [InlineData("""{"client_id":"https://claude.ai/oauth/claude-code-client-metadata","redirect_uris":[]}""")]
    [InlineData("""{"client_id":"https://claude.ai/oauth/claude-code-client-metadata"}""")]
    [InlineData("""{"client_id":"https://claude.ai/oauth/claude-code-client-metadata","redirect_uris":["http://evil.example/cb"]}""")]
    [InlineData("""{"client_id":"https://claude.ai/oauth/claude-code-client-metadata","redirect_uris":["http://127.0.0.1/cb"],"token_endpoint_auth_method":"private_key_jwt"}""")]
    [InlineData("""["not an object"]""")]
    [InlineData("not json")]
    public async Task Fetch_Refuses_ADocumentTheApiDoesntAccept(string body)
    {
        Assert.Null(await FetchAsync(new RecordingHttpHandler(HttpStatusCode.OK, body)));
    }

    [Fact]
    public async Task Fetch_Refuses_ADocumentOverTheLimit()
    {
        var padding = new string('x', ClientMetadataFetcher.MaxBytes);
        var body = JsonSerializer.Serialize(new
        {
            client_id = ClientId,
            client_name = padding,
            redirect_uris = RedirectUriList
        });

        Assert.Null(await FetchAsync(new RecordingHttpHandler(HttpStatusCode.OK, body)));
    }

    [Fact]
    public async Task Fetch_ReturnsNull_WhenTheServerCantBeReached()
    {
        Assert.Null(await FetchAsync(new ThrowingHandler()));
    }

    private static async Task<ClientMetadata?> FetchAsync(HttpMessageHandler handler)
    {
        using var httpClient = new HttpClient(handler);
        var fetcher = new ClientMetadataFetcher(httpClient, NullLogger<ClientMetadataFetcher>.Instance);
        return await fetcher.FetchAsync(ClientId, CancellationToken.None);
    }

    private static string Document(string clientId = ClientId)
    {
        return JsonSerializer.Serialize(new
        {
            client_id = clientId,
            client_name = "Claude Code",
            redirect_uris = RedirectUriList,
            grant_types = GrantTypes,
            token_endpoint_auth_method = "none"
        });
    }

    private sealed class ThrowingHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            throw new HttpRequestException("No route to host.");
        }
    }
}
