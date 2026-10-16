using System.Net;
using System.Text;
using System.Text.Json;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Suggestions.Foundry;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class FoundryTagSuggesterTests
{
    private static readonly List<Tag> Tags =
    [
        new()
        {
            Name = "Animals",
            FlashCards =
            [
                new() { Words = TestDb.Words("el gato", "the cat") },
                new() { Words = TestDb.Words(["solo", "únicamente"], ["only"]) }
            ]
        },
        new() { Name = "Travel" }
    ];

    [Fact]
    public async Task SuggestAsync_AsksTheModelAboutTheCardAndTags_AndReturnsItsPicks()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"tags":["Animals"]}"""));
        using var httpClient = new HttpClient(handler);

        var tags = await CreateSuggester(httpClient).SuggestAsync(
            ["el perro", "el can"], ["the dog"], Tags, CancellationToken.None);

        Assert.Equal(["Animals"], tags);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://foundry.example/openai/v1/chat/completions", request.Url);
        Assert.Equal("secret-key", request.Key);
        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal("gpt-test", root.GetProperty("model").GetString());
        Assert.Equal("tag_suggestions", root.GetProperty("response_format").GetProperty("json_schema")
            .GetProperty("name").GetString());
        var messages = root.GetProperty("messages");
        Assert.Contains("pick none", messages[0].GetProperty("content").GetString(), StringComparison.Ordinal);
        var prompt = messages[1].GetProperty("content").GetString()!.ReplaceLineEndings("\n");
        Assert.StartsWith("The card is el perro / el can = the dog.\n", prompt, StringComparison.Ordinal);
        Assert.Contains(
            "- Animals: el gato = the cat; solo / únicamente = only\n", prompt, StringComparison.Ordinal);
        Assert.Contains("- Travel: (no cards yet)\n", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestAsync_DescribesACardWithOneSideFilledIn()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"tags":[]}"""));
        using var httpClient = new HttpClient(handler);

        var tags = await CreateSuggester(httpClient).SuggestAsync([], ["the dog"], Tags, CancellationToken.None);

        Assert.Empty(tags);
        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var prompt = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
        Assert.StartsWith("The card is the dog.", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestNewAsync_AsksTheModelForNewTags_FromTheTagsAndUntaggedCards()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"tags":["Food","Colors"]}"""));
        using var httpClient = new HttpClient(handler);
        List<FlashCard> untagged = [new() { Words = TestDb.Words(["rojo"], ["red", "scarlet"]) }];

        var tags = await CreateSuggester(httpClient).SuggestNewAsync(Tags, untagged, 8, CancellationToken.None);

        Assert.Equal(["Food", "Colors"], tags);
        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var root = body.RootElement;
        Assert.Equal("tag_suggestions", root.GetProperty("response_format").GetProperty("json_schema")
            .GetProperty("name").GetString());
        var messages = root.GetProperty("messages");
        Assert.Contains(
            "Never suggest a tag the learner already has", messages[0].GetProperty("content").GetString(),
            StringComparison.Ordinal);
        var prompt = messages[1].GetProperty("content").GetString()!.ReplaceLineEndings("\n");
        Assert.StartsWith("Suggest 8 new tags.\n", prompt, StringComparison.Ordinal);
        Assert.Contains(
            "- Animals: el gato = the cat; solo / únicamente = only\n", prompt, StringComparison.Ordinal);
        Assert.Contains("- Travel: (no cards yet)\n", prompt, StringComparison.Ordinal);
        Assert.EndsWith("have no tag, as Spanish = English:\n- rojo = red / scarlet\n", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SuggestNewAsync_AsksForBeginnersTags_WithNoTagsOrCards()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, Completion("""{"tags":[]}"""));
        using var httpClient = new HttpClient(handler);

        await CreateSuggester(httpClient).SuggestNewAsync([], [], 8, CancellationToken.None);

        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        Assert.Equal(
            "The learner has no cards or tags yet. Suggest 8 tags a beginner would want first.",
            body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString());
    }

    [Fact]
    public async Task SuggestNewAsync_Throws_WhenTheServiceFails()
    {
        var handler = new FakeHandler(HttpStatusCode.TooManyRequests, """{"error":{"code":"429"}}""");
        using var httpClient = new HttpClient(handler);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateSuggester(httpClient).SuggestNewAsync(Tags, [], 8, CancellationToken.None));

        Assert.Equal(HttpStatusCode.TooManyRequests, ex.StatusCode);
    }

    [Fact]
    public async Task SuggestAsync_Throws_WhenTheServiceFails()
    {
        var handler = new FakeHandler(HttpStatusCode.TooManyRequests, """{"error":{"code":"429"}}""");
        using var httpClient = new HttpClient(handler);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateSuggester(httpClient).SuggestAsync(["el perro"], [], Tags, CancellationToken.None));

        Assert.Equal(HttpStatusCode.TooManyRequests, ex.StatusCode);
    }

    [Theory]
    [InlineData("", "secret-key", false)]
    [InlineData("https://foundry.example/", " ", false)]
    [InlineData("https://foundry.example/", "secret-key", true)]
    public void IsAvailable_DependsOnTheEndpointAndKey(string endpoint, string key, bool expected)
    {
        using var httpClient = new HttpClient();
        var suggester = new FoundryTagSuggester(
            httpClient, Options.Create(new FoundryChatOptions { Endpoint = endpoint, Key = key }));

        Assert.Equal(expected, suggester.IsAvailable);
    }

    private static FoundryTagSuggester CreateSuggester(HttpClient httpClient)
    {
        var options = new FoundryChatOptions
        {
            Endpoint = "https://foundry.example/",
            Key = "secret-key",
            Deployment = "gpt-test"
        };
        return new FoundryTagSuggester(httpClient, Options.Create(options));
    }

    // A chat completion whose answer is this text.
    private static string Completion(string content, string? refusal = null)
    {
        return JsonSerializer.Serialize(new
        {
            id = "chatcmpl-test",
            @object = "chat.completion",
            choices = new[]
            {
                new { index = 0, finish_reason = "stop", message = new { role = "assistant", content, refusal } }
            }
        });
    }

    private sealed record SentRequest(string Url, string? Key, string? Body);

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
                request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
        }
    }
}
