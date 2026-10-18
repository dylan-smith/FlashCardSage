using System.Net;
using System.Text;
using System.Text.Json;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Suggestions.Foundry;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class FoundryCardSuggesterTests
{
    private static readonly List<FlashCard> Cards =
    [
        new() { Words = TestDb.Words("el gato", "the cat"), Tags = [new Tag { Name = "animals" }, new Tag { Name = "home" }] },
        new() { Words = TestDb.Words("comer", "to eat") },
        new() { Words = TestDb.Words(["solo", "únicamente"], ["only"]) }
    ];

    [Fact]
    public async Task SuggestAsync_AsksTheModelAboutTheCards_AndReturnsItsSuggestions()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion(
            """{"cards":[{"spanish":"el perro","english":"the dog"},{"spanish":"beber","english":"to drink"}]}"""));
        using var httpClient = new HttpClient(handler);

        var suggestions = await CreateSuggester(httpClient).SuggestAsync(Cards, null, null, 8, CancellationToken.None);

        Assert.Equal([new("el perro", "the dog"), new("beber", "to drink")], suggestions);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://foundry.example/openai/v1/chat/completions", request.Url);
        Assert.Equal("secret-key", request.Key);
        Assert.Equal("application/json", request.ContentType);
        Assert.NotNull(request.ContentLength);
        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal("gpt-test", root.GetProperty("model").GetString());
        Assert.Equal("low", root.GetProperty("reasoning_effort").GetString());
        var format = root.GetProperty("response_format");
        Assert.Equal("json_schema", format.GetProperty("type").GetString());
        Assert.True(format.GetProperty("json_schema").GetProperty("strict").GetBoolean());
        var messages = root.GetProperty("messages");
        Assert.Equal("developer", messages[0].GetProperty("role").GetString());
        Assert.Equal("user", messages[1].GetProperty("role").GetString());
        var prompt = messages[1].GetProperty("content").GetString()!;
        Assert.Contains("Suggest 8 new cards", prompt, StringComparison.Ordinal);
        Assert.Contains("- el gato = the cat [animals, home]", prompt, StringComparison.Ordinal);
        Assert.Contains("- comer = to eat\n", prompt.ReplaceLineEndings("\n"), StringComparison.Ordinal);
        Assert.Contains("- solo / únicamente = only\n", prompt.ReplaceLineEndings("\n"), StringComparison.Ordinal);
        Assert.DoesNotContain("just added", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("looking at their cards tagged", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_AsksForCardsRelatedToTheGivenCard()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"cards":[]}"""));
        using var httpClient = new HttpClient(handler);

        await CreateSuggester(httpClient).SuggestAsync(Cards, Cards[0], null, 8, CancellationToken.None);

        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var prompt = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
        Assert.StartsWith("The learner just added the card el gato = the cat.", prompt, StringComparison.Ordinal);
        Assert.Contains("After lunes = Monday", prompt, StringComparison.Ordinal);
        Assert.Contains("- comer = to eat", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_AsksForCardsUnderTheGivenTag()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"cards":[]}"""));
        using var httpClient = new HttpClient(handler);

        await CreateSuggester(httpClient).SuggestAsync(Cards, null, Cards[0].Tags[0], 8, CancellationToken.None);

        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var prompt = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
        Assert.StartsWith("The learner is looking at their cards tagged animals.", prompt, StringComparison.Ordinal);
        Assert.Contains("- comer = to eat", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("just added", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_DescribesEveryWordOfTheGivenCard()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"cards":[]}"""));
        using var httpClient = new HttpClient(handler);

        await CreateSuggester(httpClient).SuggestAsync(Cards, Cards[2], null, 8, CancellationToken.None);

        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var prompt = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
        Assert.StartsWith(
            "The learner just added the card solo / únicamente = only.", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_AsksForBeginnerCards_WhenThereAreNone()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"cards":[]}"""));
        using var httpClient = new HttpClient(handler);

        var suggestions = await CreateSuggester(httpClient).SuggestAsync([], null, null, 5, CancellationToken.None);

        Assert.Empty(suggestions);
        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var prompt = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
        Assert.Contains("no cards yet. Suggest 5 cards a beginner", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_Throws_WithTheErrorCode_WhenTheServiceFails()
    {
        var handler = new FakeHandler(
            HttpStatusCode.NotFound,
            """{"error":{"code":"DeploymentNotFound","message":"The API deployment for this resource does not exist."}}""");
        using var httpClient = new HttpClient(handler);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateSuggester(httpClient).SuggestAsync(Cards, null, null, 8, CancellationToken.None));

        Assert.Equal(HttpStatusCode.NotFound, ex.StatusCode);
        Assert.Contains("(DeploymentNotFound)", ex.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("length", null)]
    [InlineData("content_filter", null)]
    [InlineData("stop", "I can't help with that.")]
    public async Task SuggestAsync_Throws_WhenTheModelDoesNotFinishItsAnswer(string finishReason, string? refusal)
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"cards":[""", finishReason, refusal));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateSuggester(httpClient).SuggestAsync(Cards, null, null, 8, CancellationToken.None));
    }

    [Fact]
    public async Task SuggestAsync_Throws_WhenTheAnswerIsNotJson()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("Here are some cards!"));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateSuggester(httpClient).SuggestAsync(Cards, null, null, 8, CancellationToken.None));
    }

    [Theory]
    [InlineData("", "secret-key", false)]
    [InlineData("https://foundry.example/", "", false)]
    [InlineData("https://foundry.example/", " ", false)]
    [InlineData("https://foundry.example/", "secret-key", true)]
    public void IsAvailable_DependsOnTheEndpointAndKey(string endpoint, string key, bool expected)
    {
        using var httpClient = new HttpClient();
        var suggester = new FoundryCardSuggester(
            httpClient, Options.Create(new FoundryChatOptions { Endpoint = endpoint, Key = key }));

        Assert.Equal(expected, suggester.IsAvailable);
    }

    private static FoundryCardSuggester CreateSuggester(HttpClient httpClient)
    {
        var options = new FoundryChatOptions
        {
            Endpoint = "https://foundry.example/",
            Key = "secret-key",
            Deployment = "gpt-test"
        };
        return new FoundryCardSuggester(httpClient, Options.Create(options));
    }

    // A chat completion whose answer is this text.
    private static string Completion(string content, string finishReason = "stop", string? refusal = null)
    {
        return JsonSerializer.Serialize(new
        {
            id = "chatcmpl-test",
            @object = "chat.completion",
            model = "gpt-5-mini-2025-08-07",
            choices = new[]
            {
                new
                {
                    index = 0,
                    finish_reason = finishReason,
                    message = new { role = "assistant", content, refusal }
                }
            }
        });
    }

    private sealed record SentRequest(string Url, string? Key, string? ContentType, long? ContentLength, string? Body);

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
                request.Headers.TryGetValues("api-key", out var keys) ? keys.Single() : null,
                request.Content?.Headers.ContentType?.MediaType,
                request.Content?.Headers.ContentLength,
                request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
        }
    }
}
