using System.Net;
using FlashCardSage.Api.Speech;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class AzureSpeechSynthesizerTests
{
    [Fact]
    public async Task SynthesizeAsync_AsksTheVoiceToReadTheTextAsAnMp3()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, "mp3 bytes");
        using var httpClient = new HttpClient(handler);

        var speech = await CreateSynthesizer(httpClient).SynthesizeAsync("¿Dónde está la biblioteca?", false, CancellationToken.None);

        Assert.Equal("audio/mpeg", speech.ContentType);
        Assert.Equal("mp3 bytes"u8.ToArray(), speech.Data.ToArray());
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Post, request.Method);
        Assert.Equal("https://speech.example/cognitiveservices/v1", request.Url);
        Assert.Equal("secret-key", request.Header("Ocp-Apim-Subscription-Key"));
        Assert.Equal("audio-24khz-48kbitrate-mono-mp3", request.Header("X-Microsoft-OutputFormat"));
        Assert.Equal("FlashCardSage", request.Header("User-Agent"));
        Assert.Equal("application/ssml+xml", request.ContentType);
        // The service refuses a chunked body.
        Assert.NotNull(request.ContentLength);
        Assert.Equal(
            "<speak version='1.0' xml:lang='es-MX'><voice name='es-MX-DaliaNeural'>¿Dónde está la biblioteca?</voice></speak>",
            request.Body);
    }

    [Fact]
    public void Ssml_EscapesTheText_SoItCannotAddMarkup()
    {
        using var httpClient = new HttpClient();

        var ssml = CreateSynthesizer(httpClient).Ssml("<break time='10s'/> & \"so\" on");

        Assert.Contains("<voice name='es-MX-DaliaNeural'>&lt;break time=&apos;10s&apos;/&gt; &amp; &quot;so&quot; on</voice>", ssml, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SynthesizeAsync_HasTheVoiceSpeakSlowly_WhenAskedTo()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, "mp3 bytes");
        using var httpClient = new HttpClient(handler);

        await CreateSynthesizer(httpClient).SynthesizeAsync("hola & adiós", true, CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal(
            "<speak version='1.0' xml:lang='es-MX'><voice name='es-MX-DaliaNeural'><prosody rate='0.70'>hola &amp; adiós</prosody></voice></speak>",
            request.Body);
    }

    [Theory]
    [InlineData("es-ES-ElviraNeural", "es-ES")]
    [InlineData("es-ES-Ximena:DragonHDLatestNeural", "es-ES")]
    public async Task SynthesizeAsync_UsesTheVoiceItIsGiven_InItsOwnLocale(string voice, string locale)
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, "mp3 bytes");
        using var httpClient = new HttpClient(handler);
        var options = new SpeechOptions { Endpoint = "https://speech.example", Key = "secret-key", Voice = voice };

        await new AzureSpeechSynthesizer(httpClient, Options.Create(options)).SynthesizeAsync("hola", false, CancellationToken.None);

        var request = Assert.Single(handler.Requests);
        Assert.Equal($"<speak version='1.0' xml:lang='{locale}'><voice name='{voice}'>hola</voice></speak>", request.Body);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized)]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task SynthesizeAsync_Throws_WhenTheServiceFails(HttpStatusCode status)
    {
        var handler = new RecordingHttpHandler(status, "");
        using var httpClient = new HttpClient(handler);

        var exception = await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateSynthesizer(httpClient).SynthesizeAsync("hola", false, CancellationToken.None));

        Assert.Equal(status, exception.StatusCode);
    }

    [Fact]
    public async Task SynthesizeAsync_Throws_WhenThereIsNoAudio()
    {
        var handler = new RecordingHttpHandler(HttpStatusCode.OK, "");
        using var httpClient = new HttpClient(handler);

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            CreateSynthesizer(httpClient).SynthesizeAsync("hola", false, CancellationToken.None));
    }

    [Theory]
    [InlineData("", "", false)]
    [InlineData("https://speech.example/", "", false)]
    [InlineData("", "secret-key", false)]
    [InlineData("https://speech.example/", "secret-key", true)]
    public void IsAvailable_NeedsAnEndpointAndAKey(string endpoint, string key, bool expected)
    {
        using var httpClient = new HttpClient();
        var options = new SpeechOptions { Endpoint = endpoint, Key = key };

        Assert.Equal(expected, new AzureSpeechSynthesizer(httpClient, Options.Create(options)).IsAvailable);
    }

    private static AzureSpeechSynthesizer CreateSynthesizer(HttpClient httpClient)
    {
        var options = new SpeechOptions { Endpoint = "https://speech.example/", Key = "secret-key" };
        return new AzureSpeechSynthesizer(httpClient, Options.Create(options));
    }
}
