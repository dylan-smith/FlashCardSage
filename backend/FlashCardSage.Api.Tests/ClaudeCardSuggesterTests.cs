using System.Net;
using System.Text;
using System.Text.Json;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class ClaudeCardSuggesterTests
{
    private static readonly List<FlashCard> Cards =
    [
        new() { Spanish = "el gato", English = "the cat", Tags = [new Tag { Name = "animals" }, new Tag { Name = "home" }] },
        new() { Spanish = "comer", English = "to eat" }
    ];

    [Fact]
    public async Task SuggestAsync_AsksClaudeAboutTheCards_AndReturnsItsSuggestions()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Message(
            """{"cards":[{"spanish":"el perro","english":"the dog"},{"spanish":"beber","english":"to drink"}]}"""));
        using var httpClient = new HttpClient(handler);
        using var suggester = CreateSuggester(httpClient);

        var suggestions = await suggester.SuggestAsync(Cards, 8, CancellationToken.None);

        Assert.Equal([new("el perro", "the dog"), new("beber", "to drink")], suggestions);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://api.anthropic.com/v1/messages?beta=true", request.Url);
        Assert.Equal("secret-key", request.ApiKey);
        Assert.Contains("server-side-fallback-2026-07-01", request.Betas, StringComparison.Ordinal);
        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal("claude-test", root.GetProperty("model").GetString());
        Assert.Equal("default", root.GetProperty("fallbacks").GetString());
        Assert.Equal("low", root.GetProperty("output_config").GetProperty("effort").GetString());
        Assert.Equal("json_schema", root.GetProperty("output_config").GetProperty("format").GetProperty("type").GetString());
        var prompt = root.GetProperty("messages")[0].GetProperty("content").GetString()!;
        Assert.Contains("Suggest 8 new cards", prompt, StringComparison.Ordinal);
        Assert.Contains("- el gato = the cat [animals, home]", prompt, StringComparison.Ordinal);
        Assert.Contains("- comer = to eat\n", prompt.ReplaceLineEndings("\n"), StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_AsksForBeginnerCards_WhenThereAreNone()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Message("""{"cards":[]}"""));
        using var httpClient = new HttpClient(handler);
        using var suggester = CreateSuggester(httpClient);

        var suggestions = await suggester.SuggestAsync([], 5, CancellationToken.None);

        Assert.Empty(suggestions);
        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var prompt = body.RootElement.GetProperty("messages")[0].GetProperty("content").GetString()!;
        Assert.Contains("no cards yet. Suggest 5 cards a beginner", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_Throws_WhenClaudeFails()
    {
        var handler = new FakeHandler(
            HttpStatusCode.BadRequest,
            """{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}""");
        using var httpClient = new HttpClient(handler);
        using var suggester = CreateSuggester(httpClient);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            suggester.SuggestAsync(Cards, 8, CancellationToken.None));
    }

    [Fact]
    public async Task SuggestAsync_Throws_WhenClaudeRefuses()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Message("", stopReason: "refusal"));
        using var httpClient = new HttpClient(handler);
        using var suggester = CreateSuggester(httpClient);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            suggester.SuggestAsync(Cards, 8, CancellationToken.None));
    }

    [Fact]
    public async Task SuggestAsync_Throws_WhenTheAnswerIsNotJson()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Message("Here are some cards!"));
        using var httpClient = new HttpClient(handler);
        using var suggester = CreateSuggester(httpClient);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            suggester.SuggestAsync(Cards, 8, CancellationToken.None));
    }

    [Theory]
    [InlineData("", false)]
    [InlineData(" ", false)]
    [InlineData("secret-key", true)]
    public void IsAvailable_DependsOnTheApiKey(string apiKey, bool expected)
    {
        using var httpClient = new HttpClient();
        using var suggester = new ClaudeCardSuggester(httpClient, Options.Create(new CardSuggesterOptions { ApiKey = apiKey }));

        Assert.Equal(expected, suggester.IsAvailable);
    }

    private static ClaudeCardSuggester CreateSuggester(HttpClient httpClient)
    {
        var options = new CardSuggesterOptions { ApiKey = "secret-key", Model = "claude-test" };
        return new ClaudeCardSuggester(httpClient, Options.Create(options));
    }

    // A Messages API response whose only content is this text.
    private static string Message(string text, string stopReason = "end_turn")
    {
        return JsonSerializer.Serialize(new
        {
            id = "msg_test",
            type = "message",
            role = "assistant",
            model = "claude-test",
            content = new[] { new { type = "text", text } },
            stop_reason = stopReason,
            usage = new { input_tokens = 100, output_tokens = 50 }
        });
    }

    private sealed record SentRequest(string Url, string? ApiKey, string Betas, string? Body);

    // Answers every request the same way, and keeps what was sent.
    private sealed class FakeHandler(HttpStatusCode status, string body) : HttpMessageHandler
    {
        public List<SentRequest> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Requests.Add(new SentRequest(
                request.RequestUri!.ToString(),
                request.Headers.TryGetValues("x-api-key", out var keys) ? keys.Single() : null,
                request.Headers.TryGetValues("anthropic-beta", out var betas) ? string.Join(',', betas) : string.Empty,
                request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
        }
    }
}
