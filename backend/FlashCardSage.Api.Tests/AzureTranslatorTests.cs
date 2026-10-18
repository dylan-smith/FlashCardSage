using System.Net;
using System.Text;
using System.Text.Json;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class AzureTranslatorTests
{
    private const string ChairLookup = """
        [{"translations":[
          {"displayTarget":"presidente","confidence":0.15},
          {"displayTarget":"silla","confidence":0.59},
          {"displayTarget":"Cátedra","confidence":0.19},
          {"displayTarget":"Silla","confidence":0.05},
          {"displayTarget":"presidir","confidence":0.06}
        ]}]
        """;

    [Fact]
    public async Task TranslateAsync_LooksUpASingleWord_AndOffersItsOtherMeanings()
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, ChairLookup));
        using var httpClient = new HttpClient(handler);

        var result = await CreateTranslator(httpClient).TranslateAsync("chair", Language.English, CancellationToken.None);

        Assert.Equal("silla", result.Text);
        Assert.Equal(["cátedra", "presidente", "presidir"], result.Alternatives);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://translator.example/dictionary/lookup?api-version=3.0&from=en&to=es", request.Url);
        Assert.Equal("secret-key", request.Key);
        using var body = JsonDocument.Parse(request.Body!);
        Assert.Equal("chair", body.RootElement[0].GetProperty("text").GetString());
    }

    [Fact]
    public async Task TranslateAsync_OffersAtMostFourOtherMeanings()
    {
        var meanings = string.Join(',', Enumerable.Range(1, 8).Select(i => $$"""{"displayTarget":"m{{i}}","confidence":0.{{9 - i}}}"""));
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, $$"""[{"translations":[{{meanings}}]}]"""));
        using var httpClient = new HttpClient(handler);

        var result = await CreateTranslator(httpClient).TranslateAsync("light", Language.English, CancellationToken.None);

        Assert.Equal("m1", result.Text);
        Assert.Equal(["m2", "m3", "m4", "m5"], result.Alternatives);
    }

    [Fact]
    public async Task TranslateAsync_TranslatesAPhrase_InLowercaseLikeTheText()
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, """[{"translations":[{"text":"The black cat","to":"en"}]}]"""));
        using var httpClient = new HttpClient(handler);

        var result = await CreateTranslator(httpClient).TranslateAsync("el gato negro", Language.Spanish, CancellationToken.None);

        Assert.Equal("the black cat", result.Text);
        Assert.Empty(result.Alternatives);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("https://translator.example/translate?api-version=3.0&from=es&to=en", request.Url);
    }

    [Theory]
    [InlineData("el perro negro", Language.Spanish, "The Black Dog", "the black dog")]
    [InlineData("yo vivo en madrid", Language.Spanish, "I live in Madrid", "I live in madrid")]
    [InlineData("vivo en Madrid", Language.Spanish, "I live in Madrid", "I live in Madrid")]
    [InlineData("la Casa Blanca", Language.Spanish, "The White House", "the White House")]
    [InlineData("El perro negro", Language.Spanish, "The Black Dog", "The Black Dog")]
    [InlineData("the black dog", Language.English, "El Perro Negro", "el perro negro")]
    public async Task TranslateAsync_MatchesTheCaseOfTheText(string text, Language from, string translated, string expected)
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, $$"""[{"translations":[{"text":"{{translated}}"}]}]"""));
        using var httpClient = new HttpClient(handler);

        var result = await CreateTranslator(httpClient).TranslateAsync(text, from, CancellationToken.None);

        Assert.Equal(expected, result.Text);
    }

    [Fact]
    public async Task TranslateAsync_TranslatesAWordTheDictionaryDoesNotKnow_KeepingItsCapital()
    {
        var handler = new FakeHandler(url => url.Contains("/dictionary/", StringComparison.Ordinal)
            ? (HttpStatusCode.OK, """[{"translations":[]}]""")
            : (HttpStatusCode.OK, """[{"translations":[{"text":"Madrid","to":"en"}]}]"""));
        using var httpClient = new HttpClient(handler);

        var result = await CreateTranslator(httpClient).TranslateAsync("Madrid", Language.Spanish, CancellationToken.None);

        Assert.Equal("Madrid", result.Text);
        Assert.Empty(result.Alternatives);
        Assert.Equal(
            ["https://translator.example/dictionary/lookup?api-version=3.0&from=es&to=en",
             "https://translator.example/translate?api-version=3.0&from=es&to=en"],
            handler.Requests.Select(request => request.Url));
    }

    [Fact]
    public async Task TranslateAsync_Throws_WhenTheServiceFails()
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.Unauthorized, """{"error":{"code":401000}}"""));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateTranslator(httpClient).TranslateAsync("gato", Language.Spanish, CancellationToken.None));
    }

    [Fact]
    public async Task TranslateAsync_Throws_WhenThereIsNoTranslation()
    {
        var handler = new FakeHandler(_ => (HttpStatusCode.OK, "[]"));
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateTranslator(httpClient).TranslateAsync("gato", Language.Spanish, CancellationToken.None));
    }

    [Theory]
    [InlineData("", false)]
    [InlineData(" ", false)]
    [InlineData("secret-key", true)]
    public void IsAvailable_DependsOnTheKey(string key, bool expected)
    {
        using var httpClient = new HttpClient();
        var translator = new AzureTranslator(httpClient, Options.Create(new TranslatorOptions { Key = key }));

        Assert.Equal(expected, translator.IsAvailable);
    }

    private static AzureTranslator CreateTranslator(HttpClient httpClient)
    {
        var options = new TranslatorOptions { Endpoint = "https://translator.example/", Key = "secret-key" };
        return new AzureTranslator(httpClient, Options.Create(options));
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
                request.Headers.TryGetValues("Ocp-Apim-Subscription-Key", out var keys) ? keys.Single() : null,
                request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
            var (status, body) = respond(url);
            return new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json")
            };
        }
    }
}
