using System.Net;
using System.Text;
using System.Text.Json;
using FlashCardSage.Api.Images;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class AzureOpenAiImageGeneratorTests
{
    private static readonly string Picture = Convert.ToBase64String(CardImageTests.Jpeg);

    [Fact]
    public async Task GenerateAsync_AsksTheDeploymentForASmallJpeg_AndDecodesIt()
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, $$"""{"created":1,"data":[{"b64_json":"{{Picture}}"}]}"""));
        using var httpClient = new HttpClient(handler);

        var image = await CreateGenerator(httpClient).GenerateAsync("nadar", "to swim", CancellationToken.None);

        Assert.Equal("image/jpeg", image.ContentType);
        Assert.Equal(CardImageTests.Jpeg, image.Data.ToArray());
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(
            "https://openai.example/openai/deployments/gpt-image-1-mini/images/generations?api-version=2025-04-01-preview",
            request.Url);
        Assert.Equal("secret-key", request.Key);
        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal(AzureOpenAiImageGenerator.Prompt("nadar", "to swim"), root.GetProperty("prompt").GetString());
        Assert.Equal(1, root.GetProperty("n").GetInt32());
        Assert.Equal("1024x1024", root.GetProperty("size").GetString());
        Assert.Equal("low", root.GetProperty("quality").GetString());
        Assert.Equal("jpeg", root.GetProperty("output_format").GetString());
        Assert.Equal(80, root.GetProperty("output_compression").GetInt32());
    }

    [Theory]
    [InlineData("nadar", "to swim", "the Spanish \"nadar\" (\"to swim\" in English)")]
    [InlineData("nadar", "", "the Spanish \"nadar\"")]
    [InlineData("", "to swim", "the English \"to swim\"")]
    public void Prompt_NamesTheSidesThatAreFilledIn_AndAsksForNoText(string spanish, string english, string subject)
    {
        var prompt = AzureOpenAiImageGenerator.Prompt(spanish, english);

        Assert.Contains($"showing the meaning of {subject}.", prompt, StringComparison.Ordinal);
        Assert.Contains("No text", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"error":{"code":"contentFilter","message":"Your task failed as a result of our safety system."}}""")]
    [InlineData("""{"error":{"code":"content_policy_violation","message":"blocked"}}""")]
    [InlineData("""{"error":{"code":"invalid_request_error","inner_error":{"code":"ResponsibleAIPolicyViolation"}}}""")]
    public async Task GenerateAsync_Throws_WhenTheContentFilterRefuses(string body)
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.BadRequest, body));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<ImageContentFilteredException>(() =>
            CreateGenerator(httpClient).GenerateAsync("x", "y", CancellationToken.None));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, """{"error":{"code":"401","message":"Access denied"}}""")]
    [InlineData(HttpStatusCode.BadRequest, """{"error":{"code":"invalid_request_error","message":"bad size"}}""")]
    [InlineData(HttpStatusCode.TooManyRequests, "")]
    [InlineData(HttpStatusCode.InternalServerError, "not json")]
    public async Task GenerateAsync_Throws_WhenTheServiceFails(HttpStatusCode status, string body)
    {
        var handler = new FakeHandler(_ => (status, body));
        using var httpClient = new HttpClient(handler);

        var exception = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateGenerator(httpClient).GenerateAsync("x", "y", CancellationToken.None));

        Assert.Equal(status, exception.StatusCode);
    }

    [Theory]
    [InlineData("""{"created":1,"data":[]}""")]
    [InlineData("""{"created":1,"data":[{"b64_json":""}]}""")]
    [InlineData("""{"created":1}""")]
    public async Task GenerateAsync_Throws_WhenThereIsNoPicture(string body)
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, body));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateGenerator(httpClient).GenerateAsync("x", "y", CancellationToken.None));
    }

    [Theory]
    [InlineData("", "", false)]
    [InlineData("https://openai.example/", "", false)]
    [InlineData("", "secret-key", false)]
    [InlineData("https://openai.example/", "secret-key", true)]
    public void IsAvailable_NeedsAnEndpointAndAKey(string endpoint, string key, bool expected)
    {
        using var httpClient = new HttpClient();
        var options = new ImageGenerationOptions { Endpoint = endpoint, Key = key };

        Assert.Equal(expected, new AzureOpenAiImageGenerator(httpClient, Options.Create(options)).IsAvailable);
    }

    private static AzureOpenAiImageGenerator CreateGenerator(HttpClient httpClient)
    {
        var options = new ImageGenerationOptions { Endpoint = "https://openai.example/", Key = "secret-key" };
        return new AzureOpenAiImageGenerator(httpClient, Options.Create(options));
    }

    private sealed record SentRequest(HttpMethod Method, string Url, string? Key, string? Body);

    // Answers each request by its URL, and keeps what was sent.
    private sealed class FakeHandler(Func<string, (HttpStatusCode Status, string Body)> respond) : HttpMessageHandler
    {
        public List<SentRequest> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var url = request.RequestUri!.ToString();
            Requests.Add(new SentRequest(
                request.Method,
                url,
                request.Headers.TryGetValues("api-key", out var keys) ? keys.Single() : null,
                request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
            var (status, body) = respond(url);
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
        }
    }
}
