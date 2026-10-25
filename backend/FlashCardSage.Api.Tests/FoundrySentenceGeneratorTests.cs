using System.Net;
using System.Text.Json;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Suggestions.Foundry;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class FoundrySentenceGeneratorTests
{
    private static readonly List<FlashCard> Cards =
    [
        new() { Id = 12, Words = TestDb.Words("el gato", "the cat") },
        new() { Id = 15, Words = TestDb.Words("comer", "to eat") },
        new() { Id = 20, Words = TestDb.Words(["solo", "únicamente"], ["only"]) }
    ];

    [Fact]
    public async Task GenerateAsync_AsksTheModelAboutTheCards_AndReturnsItsSentences()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, ChatCompletion.Json(
            """{"sentences":[{"spanish":"El gato come solo.","english":"The cat eats alone.","cardIds":[12,15,20]}]}"""));
        using var httpClient = new HttpClient(handler);

        var sentences = await CreateGenerator(httpClient).GenerateAsync(Cards, 7, CancellationToken.None);

        var sentence = Assert.Single(sentences);
        Assert.Equal("El gato come solo.", sentence.Spanish);
        Assert.Equal("The cat eats alone.", sentence.English);
        Assert.Equal([12, 15, 20], sentence.CardIds);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://foundry.example/openai/v1/chat/completions", request.Url);
        Assert.Equal("secret-key", request.Header("api-key"));
        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal("gpt-test", root.GetProperty("model").GetString());
        var schema = root.GetProperty("response_format").GetProperty("json_schema");
        Assert.Equal("practice_sentences", schema.GetProperty("name").GetString());
        Assert.True(schema.GetProperty("strict").GetBoolean());
        var messages = root.GetProperty("messages");
        Assert.Equal(FoundrySentenceGenerator.Instructions, messages[0].GetProperty("content").GetString());
        var prompt = messages[1].GetProperty("content").GetString()!.ReplaceLineEndings("\n");
        Assert.StartsWith("Write 7 sentences.", prompt, StringComparison.Ordinal);
        Assert.Contains("- 12: el gato = the cat\n", prompt, StringComparison.Ordinal);
        Assert.Contains("- 15: comer = to eat\n", prompt, StringComparison.Ordinal);
        Assert.Contains("- 20: solo / únicamente = only\n", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Instructions_KeepTheSpanishUnderTheLimit()
    {
        Assert.Contains(
            $"under {SentencePracticeResult.MaxSentenceLength} characters",
            FoundrySentenceGenerator.Instructions.ReplaceLineEndings(" "),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task GenerateAsync_Throws_WithTheErrorCode_WhenTheServiceFails()
    {
        var handler = new RecordingHttpHandler(
            HttpStatusCode.NotFound,
            """{"error":{"code":"DeploymentNotFound","message":"The API deployment for this resource does not exist."}}""");
        using var httpClient = new HttpClient(handler);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateGenerator(httpClient).GenerateAsync(Cards, 7, CancellationToken.None));

        Assert.Equal(HttpStatusCode.NotFound, ex.StatusCode);
        Assert.Contains("(DeploymentNotFound)", ex.Message, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("length", null)]
    [InlineData("content_filter", null)]
    [InlineData("stop", "I can't help with that.")]
    public async Task GenerateAsync_Throws_WhenTheModelDoesNotFinishItsAnswer(string finishReason, string? refusal)
    {
        var handler = new RecordingHttpHandler(
            HttpStatusCode.OK, ChatCompletion.Json("""{"sentences":[""", finishReason, refusal));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateGenerator(httpClient).GenerateAsync(Cards, 7, CancellationToken.None));
    }

    [Fact]
    public async Task GenerateAsync_Throws_WhenTheAnswerIsNotJson()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, ChatCompletion.Json("Here are some sentences!"));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateGenerator(httpClient).GenerateAsync(Cards, 7, CancellationToken.None));
    }

    [Theory]
    [InlineData("stop")]
    [InlineData("length")]
    public async Task GenerateAsync_LogsTheTokensTheModelUsed_EvenWhenItsAnswerCantBeUsed(string finishReason)
    {
        var handler = new RecordingHttpHandler(
            HttpStatusCode.OK, ChatCompletion.Json("""{"sentences":[]}""", finishReason));
        using var httpClient = new HttpClient(handler);
        var logger = new RecordingLogger<FoundrySentenceGenerator>();
        var generator = new FoundrySentenceGenerator(httpClient, FoundryTestOptions.Default, logger);

        try
        {
            await generator.GenerateAsync(Cards, 7, CancellationToken.None);
        }
        catch (HttpRequestException)
        {
            // An answer cut short is an error, but its tokens are paid for.
        }

        var entry = Assert.Single(logger.Entries);
        Assert.Equal("gpt-5-mini-2025-08-07", entry["ChatModel"]);
        Assert.Equal(1200, entry["PromptTokens"]);
        Assert.Equal(256, entry["CachedPromptTokens"]);
        Assert.Equal(300, entry["CompletionTokens"]);
        Assert.Equal(192, entry["ReasoningTokens"]);
        Assert.Equal(finishReason, entry["FinishReason"]);
    }

    [Theory]
    [InlineData("", "secret-key", false)]
    [InlineData("https://foundry.example/", "", false)]
    [InlineData("https://foundry.example/", " ", false)]
    [InlineData("https://foundry.example/", "secret-key", true)]
    public void IsAvailable_DependsOnTheEndpointAndKey(string endpoint, string key, bool expected)
    {
        using var httpClient = new HttpClient();
        var generator = new FoundrySentenceGenerator(
            httpClient,
            Options.Create(new FoundryChatOptions { Endpoint = endpoint, Key = key }),
            NullLogger<FoundrySentenceGenerator>.Instance);

        Assert.Equal(expected, generator.IsAvailable);
    }

    private static FoundrySentenceGenerator CreateGenerator(HttpClient httpClient)
    {
        return new FoundrySentenceGenerator(
            httpClient, FoundryTestOptions.Default, NullLogger<FoundrySentenceGenerator>.Instance);
    }
}
