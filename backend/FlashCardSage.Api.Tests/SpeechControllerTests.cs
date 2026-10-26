using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Speech;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public sealed class SpeechControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    // The body that asks to hear one word.
    private static readonly object Hola = new { texts = new[] { "hola" } };

    // Where the app-level tests' audio goes, instead of the API project's App_Data.
    private readonly string files = Path.Join(Path.GetTempPath(), $"FlashCardSage-{Guid.NewGuid():N}");

    // The speech settings: no service to read with, and files on disk, in the test's own folder.
    private Dictionary<string, string> Settings => new()
    {
        ["Speech:Endpoint"] = "",
        ["Speech:Key"] = "",
        ["ImageStore:StorageConnectionString"] = "",
        ["ImageStore:LocalPath"] = files
    };

    public void Dispose()
    {
        if (Directory.Exists(files))
        {
            Directory.Delete(files, recursive: true);
        }
    }

    [Fact]
    public async Task Speak_ReturnsAUrlForEachTrimmedText_InOrder()
    {
        await using var dbContext = TestDb.Create();
        var synthesizer = new FakeSpeechSynthesizer();
        var store = new FakeImageStore();

        var result = await CreateController(dbContext, synthesizer, store).Speak(
            new SpeechRequest { Texts = [" solo ", "únicamente"] }, CancellationToken.None);

        var response = ActionResultAssert.Ok<SpeechResponse>(result.Result);
        Assert.Equal(["solo", "únicamente"], synthesizer.Calls);
        Assert.Equal([false, false], synthesizer.SlowCalls);
        // The same audio for both, from the fake, so both get its one file.
        Assert.Equal([store.Saved[0].Url, store.Saved[0].Url], response.Urls);
        Assert.Equal(2, dbContext.GeneratedAudio.Count());
    }

    [Theory]
    [InlineData("   ")]
    [InlineData("")]
    public async Task Speak_ReturnsValidationProblem_WhenATextIsBlank(string blank)
    {
        await using var dbContext = TestDb.Create();
        var synthesizer = new FakeSpeechSynthesizer();

        var result = await CreateController(dbContext, synthesizer).Speak(
            new SpeechRequest { Texts = ["hola", blank] }, CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "Texts", "Each text is required.");
        Assert.Empty(synthesizer.Calls);
    }

    [Fact]
    public async Task Speak_ReturnsValidationProblem_WhenATextIsTooLong()
    {
        await using var dbContext = TestDb.Create();
        var synthesizer = new FakeSpeechSynthesizer();

        var result = await CreateController(dbContext, synthesizer).Speak(
            new SpeechRequest { Texts = [new string('a', CachedAudio.MaxTextLength + 1)] }, CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "Texts", "A text can be at most 300 characters.");
        Assert.Empty(synthesizer.Calls);
    }

    [Fact]
    public async Task Speak_ReadsASentenceLongerThanACardsWords()
    {
        await using var dbContext = TestDb.Create();
        var synthesizer = new FakeSpeechSynthesizer();
        var sentence = new string('a', 250);

        var result = await CreateController(dbContext, synthesizer).Speak(
            new SpeechRequest { Texts = [sentence] }, CancellationToken.None);

        var response = ActionResultAssert.Ok<SpeechResponse>(result.Result);
        Assert.Single(response.Urls);
        Assert.Equal([sentence], synthesizer.Calls);
    }

    [Fact]
    public async Task Speak_ReturnsServiceUnavailable_WhenAudioIsOff()
    {
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, new FakeSpeechSynthesizer { IsAvailable = false }).Speak(
            new SpeechRequest { Texts = ["hola"] }, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status503ServiceUnavailable, "Audio isn't available.");
    }

    [Fact]
    public async Task Speak_ReturnsCachedAudio_WhenAudioIsOff()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        await CreateController(dbContext, store: store).Speak(new SpeechRequest { Texts = ["hola"] }, CancellationToken.None);

        var result = await CreateController(dbContext, new FakeSpeechSynthesizer { IsAvailable = false }, store).Speak(
            new SpeechRequest { Texts = ["hola"] }, CancellationToken.None);

        var response = ActionResultAssert.Ok<SpeechResponse>(result.Result);
        Assert.Equal([Assert.Single(store.Saved).Url], response.Urls);
    }

    [Fact]
    public async Task Speak_ReadsOnlyTheTextsNotHeardYet()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        await CreateController(dbContext, store: store).Speak(new SpeechRequest { Texts = ["solo"] }, CancellationToken.None);
        var synthesizer = new FakeSpeechSynthesizer();

        var result = await CreateController(dbContext, synthesizer, store).Speak(
            new SpeechRequest { Texts = ["solo", "únicamente"] }, CancellationToken.None);

        var response = ActionResultAssert.Ok<SpeechResponse>(result.Result);
        Assert.Equal(["únicamente"], synthesizer.Calls);
        Assert.Equal(2, response.Urls.Count);
    }

    [Fact]
    public async Task Speak_ReadsTheTextsSlowly_WhenAskedTo_ApartFromTheirNormalSpeed()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        await CreateController(dbContext, store: store).Speak(new SpeechRequest { Texts = ["solo"] }, CancellationToken.None);
        var synthesizer = new FakeSpeechSynthesizer();

        var result = await CreateController(dbContext, synthesizer, store).Speak(
            new SpeechRequest { Texts = ["solo"], Slow = true }, CancellationToken.None);

        ActionResultAssert.Ok<SpeechResponse>(result.Result);
        Assert.Equal(["solo"], synthesizer.Calls);
        Assert.Equal([true], synthesizer.SlowCalls);
        Assert.Equal(2, dbContext.GeneratedAudio.Count());
    }

    [Theory]
    [InlineData(typeof(HttpRequestException))]
    [InlineData(typeof(TaskCanceledException))]
    public async Task Speak_ReturnsBadGateway_WhenTheServiceFailsOrTimesOut(Type failure)
    {
        await using var dbContext = TestDb.Create();
        var synthesizer = new FakeSpeechSynthesizer { Failure = (Exception)Activator.CreateInstance(failure, "boom")! };

        var result = await CreateController(dbContext, synthesizer).Speak(
            new SpeechRequest { Texts = ["hola"] }, CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway, "Loading the audio failed.");
    }

    [Fact]
    public async Task Speak_RequiresSignIn()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings);

        var response = await client.PostAsJsonAsync("/api/speech", Hola);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Speak_IsUnavailable_WithoutAnEndpointAndKey()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);

        var response = await client.PostAsJsonAsync("/api/speech", Hola);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Theory]
    [InlineData("{\"texts\":[]}")]
    [InlineData("{}")]
    [InlineData("{\"texts\":[\"1\",\"2\",\"3\",\"4\",\"5\",\"6\",\"7\",\"8\",\"9\",\"10\",\"11\"]}")]
    public async Task Speak_ReturnsBadRequest_ForTheWrongNumberOfTexts(string body)
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);
        using var content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");

        var response = await client.PostAsync("/api/speech", content);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Speak_KeepsTheSampleAudioAsALocalFile_WhichAnyoneCanPlay()
    {
        var settings = Settings;
        settings["Speech:UseSampleAudio"] = "true";
        using var client = TestApp.CreateSignedInClient(factory, settings: settings);

        var response = await client.PostAsJsonAsync("/api/speech", Hola);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var speech = (await response.Content.ReadFromJsonAsync<SpeechResponse>())!;
        var url = Assert.Single(speech.Urls);
        Assert.Matches(@"^http://localhost/card-images/[0-9a-f]{32}\.mp3$", url);
        Assert.Single(Directory.GetFiles(files));

        // The audio is played by the browser like any media, so it doesn't need the user's token.
        using var anyone = TestApp.CreateSignedOutClient(factory, settings);
        var audio = await anyone.GetAsync(new Uri(url));
        Assert.Equal(HttpStatusCode.OK, audio.StatusCode);
        Assert.Equal("audio/mpeg", audio.Content.Headers.ContentType?.MediaType);
        Assert.Equal(SampleSpeechSynthesizer.Audio, await audio.Content.ReadAsByteArrayAsync());
    }

    private static SpeechController CreateController(
        FlashCardDbContext dbContext, FakeSpeechSynthesizer? synthesizer = null, FakeImageStore? store = null)
    {
        return new SpeechController(
            new CachedSpeechSynthesizer(
                synthesizer ?? new FakeSpeechSynthesizer(),
                store ?? new FakeImageStore(),
                dbContext,
                Options.Create(new SpeechOptions()),
                NullLogger<CachedSpeechSynthesizer>.Instance),
            NullLogger<SpeechController>.Instance);
    }
}
