using System.Net;
using System.Text.Json;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Tests.Fakes;

namespace FlashCardSage.Api.Tests;

public class FoundryDocumentScannerTests
{
    [Fact]
    public async Task ScanAsync_AsksTheModelAboutTheDocument_AndReturnsItsCards()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, ChatCompletion.Json(
            """{"cards":[{"spanish":"el perro","english":"the dog"},{"spanish":"correr","english":"to run"}]}"""));
        using var httpClient = new HttpClient(handler);
        List<FlashCard> cards =
        [
            TestDb.Card("el gato", "the cat"),
            new() { Words = TestDb.Words(["solo", "únicamente"], ["only"]) }
        ];

        var scanned = await CreateScanner(httpClient).ScanAsync(
            "El perro corre solo detrás del gato.", cards, 110, CancellationToken.None);

        Assert.Equal([new("el perro", "the dog"), new("correr", "to run")], scanned);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://foundry.example/openai/v1/chat/completions", request.Url);
        Assert.Equal("secret-key", request.Header("api-key"));
        using var body = JsonDocument.Parse(request.Body!);
        var root = body.RootElement;
        Assert.Equal("gpt-test", root.GetProperty("model").GetString());
        Assert.Equal(8192, root.GetProperty("max_completion_tokens").GetInt32());
        Assert.Equal(
            "document_cards", root.GetProperty("response_format").GetProperty("json_schema").GetProperty("name").GetString());
        var prompt = root.GetProperty("messages")[1].GetProperty("content").GetString()!.ReplaceLineEndings("\n");
        Assert.StartsWith("Make up to 110 cards from the document below.\n", prompt, StringComparison.Ordinal);
        Assert.Contains("- el gato = the cat\n- solo / únicamente = only\n", prompt, StringComparison.Ordinal);
        Assert.EndsWith("<document>\nEl perro corre solo detrás del gato.\n</document>\n", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ScanAsync_LeavesOutTheCards_WhenTheUserHasNoneInTheDocument()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, ChatCompletion.Json("""{"cards":[]}"""));
        using var httpClient = new HttpClient(handler);

        var scanned = await CreateScanner(httpClient).ScanAsync("Hola.", [], 110, CancellationToken.None);

        Assert.Empty(scanned);
        using var body = JsonDocument.Parse(Assert.Single(handler.Requests).Body!);
        var prompt = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
        Assert.DoesNotContain("already has", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ScanAsync_Throws_WhenTheServiceFails()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.TooManyRequests, """{"error":{"code":"429"}}""");
        using var httpClient = new HttpClient(handler);

        var ex = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateScanner(httpClient).ScanAsync("Hola.", [], 110, CancellationToken.None));

        Assert.Equal(HttpStatusCode.TooManyRequests, ex.StatusCode);
    }

    private static FoundryDocumentScanner CreateScanner(HttpClient httpClient)
    {
        return new FoundryDocumentScanner(httpClient, FoundryTestOptions.Default);
    }

}
