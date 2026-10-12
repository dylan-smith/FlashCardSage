using System.Net;
using System.Text;
using System.Text.Json;
using FlashCardSage.Api.Translation;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class AzureTranslatorTests
{
    [Fact]
    public async Task TranslateAsync_SendsTheTextFromSpanishToEnglish_AndReturnsTheTranslation()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, """[{"translations":[{"text":"the cat","to":"en"}]}]""");
        var translator = CreateTranslator(handler);

        var translation = await translator.TranslateAsync("el gato", Language.Spanish, CancellationToken.None);

        Assert.Equal("the cat", translation);
        Assert.Equal(HttpMethod.Post, handler.Request!.Method);
        Assert.Equal(
            "https://translator.example/translate?api-version=3.0&from=es&to=en",
            handler.Request.RequestUri!.ToString());
        Assert.Equal("secret-key", Assert.Single(handler.Request.Headers.GetValues("Ocp-Apim-Subscription-Key")));
        using var body = JsonDocument.Parse(handler.Body!);
        Assert.Equal("el gato", body.RootElement[0].GetProperty("text").GetString());
    }

    [Fact]
    public async Task TranslateAsync_TranslatesEnglishToSpanish()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, """[{"translations":[{"text":"el gato","to":"es"}]}]""");

        var translation = await CreateTranslator(handler).TranslateAsync("the cat", Language.English, CancellationToken.None);

        Assert.Equal("el gato", translation);
        Assert.EndsWith("from=en&to=es", handler.Request!.RequestUri!.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task TranslateAsync_Throws_WhenTheServiceFails()
    {
        var handler = new FakeHandler(HttpStatusCode.Unauthorized, """{"error":{"code":401000}}""");

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateTranslator(handler).TranslateAsync("el gato", Language.Spanish, CancellationToken.None));
    }

    [Fact]
    public async Task TranslateAsync_Throws_WhenThereIsNoTranslation()
    {
        var handler = new FakeHandler(HttpStatusCode.OK, "[]");

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateTranslator(handler).TranslateAsync("el gato", Language.Spanish, CancellationToken.None));
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

    private static AzureTranslator CreateTranslator(FakeHandler handler)
    {
        var options = new TranslatorOptions { Endpoint = "https://translator.example/", Key = "secret-key" };
        return new AzureTranslator(new HttpClient(handler), Options.Create(options));
    }

    private sealed class FakeHandler(HttpStatusCode statusCode, string responseBody) : HttpMessageHandler
    {
        public HttpRequestMessage? Request { get; private set; }

        public string? Body { get; private set; }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            Request = request;
            Body = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
            return new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(responseBody, Encoding.UTF8, "application/json")
            };
        }
    }
}
