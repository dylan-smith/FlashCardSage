using System.Net;
using System.Text;
using System.Text.Json;
using FlashCardSage.Api.Images;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class FoundryImageGeneratorTests
{
    private static readonly string Picture = Convert.ToBase64String(CardImageTests.Jpeg);

    [Fact]
    public async Task GenerateAsync_AsksTheModelForAMegapixelJpeg_AndDecodesIt()
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, $$"""{"created":1,"data":[{"b64_json":"{{Picture}}"}]}"""));
        using var httpClient = new HttpClient(handler);

        var image = await CreateGenerator(httpClient).GenerateAsync("nadar", "to swim", CancellationToken.None);

        Assert.Equal("image/jpeg", image.ContentType);
        Assert.Equal(CardImageTests.Jpeg, image.Data.ToArray());
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal(
            "https://foundry.example/providers/blackforestlabs/v1/flux-2-pro?api-version=preview",
            request.Url);
        Assert.Equal("Bearer secret-key", request.Authorization);
        // The service refuses a chunked body.
        Assert.Equal(request.Body!.Length, request.ContentLength);
        Assert.Equal("application/json", request.ContentType);
        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal("flux-2-pro", root.GetProperty("model").GetString());
        Assert.Equal(FoundryImageGenerator.Prompt("nadar", "to swim"), root.GetProperty("prompt").GetString());
        Assert.Equal(1024, root.GetProperty("width").GetInt32());
        Assert.Equal(1024, root.GetProperty("height").GetInt32());
        Assert.Equal("jpeg", root.GetProperty("output_format").GetString());
        Assert.Equal(1, root.GetProperty("num_images").GetInt32());
    }

    [Fact]
    public async Task GenerateAsync_CallsTheDeploymentItIsGiven()
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, $$"""{"data":[{"b64_json":"{{Picture}}"}]}"""));
        using var httpClient = new HttpClient(handler);
        var options = new ImageGenerationOptions
        {
            Endpoint = "https://foundry.example",
            Key = "secret-key",
            Deployment = "flux-2-flex",
            ApiVersion = "2026-01-01"
        };

        await new FoundryImageGenerator(httpClient, Options.Create(options)).GenerateAsync("x", "y", CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://foundry.example/providers/blackforestlabs/v1/flux-2-flex?api-version=2026-01-01", request.Url);
        using var body = JsonDocument.Parse(request.Body!);
        Assert.Equal("flux-2-flex", body.RootElement.GetProperty("model").GetString());
    }

    [Theory]
    [InlineData("nadar", "to swim", "to swim")]
    [InlineData("", "to swim", "to swim")]
    [InlineData("nadar", "", "the Spanish word nadar")]
    public void Prompt_DescribesTheEnglishOrElseTheSpanish_AndAsksForNoWriting(string spanish, string english, string subject)
    {
        var prompt = FoundryImageGenerator.Prompt(spanish, english);

        Assert.Contains($"showing the idea of: {subject}.", prompt, StringComparison.Ordinal);
        Assert.Contains("no writing at all", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("\"", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("""{"error":{"code":"contentFilter","message":"Your task failed as a result of our safety system."}}""")]
    [InlineData("""{"error":{"code":"content_policy_violation","message":"blocked"}}""")]
    [InlineData("""{"error":{"code":"content_moderation","message":"Request Moderated"}}""")]
    [InlineData("""{"error":{"code":"invalid_request_error","inner_error":{"code":"ResponsibleAIPolicyViolation"}}}""")]
    public async Task GenerateAsync_Throws_WhenASafetySystemRefuses(string body)
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.BadRequest, body));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<ImageContentFilteredException>(() =>
            CreateGenerator(httpClient).GenerateAsync("x", "y", CancellationToken.None));
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, """{"error":{"code":"401","message":"Access denied"}}""", "The image generator answered 401 (401).")]
    [InlineData(HttpStatusCode.BadRequest, """{"error":{"code":"no_content_length_header","message":"Content-Length header is required to make request."}}""", "The image generator answered 400 (no_content_length_header).")]
    [InlineData(HttpStatusCode.TooManyRequests, "", "The image generator answered 429.")]
    [InlineData(HttpStatusCode.InternalServerError, "not json", "The image generator answered 500.")]
    [InlineData(HttpStatusCode.InternalServerError, """{"error":"boom"}""", "The image generator answered 500.")]
    public async Task GenerateAsync_Throws_WhenTheServiceFails_NamingItsErrorCode(HttpStatusCode status, string body, string message)
    {
        var handler = new FakeHandler(_ => (status, body));
        using var httpClient = new HttpClient(handler);

        var exception = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateGenerator(httpClient).GenerateAsync("x", "y", CancellationToken.None));

        Assert.Equal(status, exception.StatusCode);
        Assert.Equal(message, exception.Message);
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
    [InlineData("https://foundry.example/", "", false)]
    [InlineData("", "secret-key", false)]
    [InlineData("https://foundry.example/", "secret-key", true)]
    public void IsAvailable_NeedsAnEndpointAndAKey(string endpoint, string key, bool expected)
    {
        using var httpClient = new HttpClient();
        var options = new ImageGenerationOptions { Endpoint = endpoint, Key = key };

        Assert.Equal(expected, new FoundryImageGenerator(httpClient, Options.Create(options)).IsAvailable);
    }

    private static FoundryImageGenerator CreateGenerator(HttpClient httpClient)
    {
        var options = new ImageGenerationOptions { Endpoint = "https://foundry.example/", Key = "secret-key" };
        return new FoundryImageGenerator(httpClient, Options.Create(options));
    }

    private sealed record SentRequest(
        HttpMethod Method, string Url, string? Authorization, string? Body, long? ContentLength, string? ContentType);

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
                request.Headers.Authorization?.ToString(),
                request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken),
                request.Content?.Headers.ContentLength,
                request.Content?.Headers.ContentType?.ToString()));
            var (status, body) = respond(url);
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
        }
    }
}
