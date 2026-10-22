using FlashCardSage.Api.Data;
using FlashCardSage.Api.Speech;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public class CachedSpeechSynthesizerTests
{
    [Fact]
    public async Task SynthesizeAsync_HasTheTextReadAndKeepsTheAudio()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        var synthesizer = new FakeSpeechSynthesizer();

        var url = await Create(dbContext, synthesizer, store).SynthesizeAsync("el gato", CancellationToken.None);

        Assert.Equal(["el gato"], synthesizer.Calls);
        var saved = Assert.Single(store.Saved);
        Assert.Equal((url, "audio/mpeg"), (saved.Url, saved.ContentType));
        Assert.Equal(FakeSpeechSynthesizer.Mp3, saved.Data);
        Assert.Matches(@"/[0-9a-f]{32}\.mp3$", url);
        var cached = Assert.Single(dbContext.GeneratedAudio);
        Assert.Equal(("es-MX-DaliaNeural", "el gato", url), (cached.Voice, cached.Text, cached.AudioUrl));
        Assert.NotEqual(default, cached.CreatedAt);
    }

    [Fact]
    public async Task FindUrlAsync_ReturnsNothing_WhenNobodyHasHeardTheText()
    {
        await using var dbContext = TestDb.Create();

        Assert.Null(await Create(dbContext).FindUrlAsync("el gato", CancellationToken.None));
    }

    [Fact]
    public async Task FindUrlAsync_ReturnsTheAudioKept_ForEveryUser()
    {
        var databaseName = TestDb.NewDatabaseName();
        string url;
        await using (var dbContext = TestDb.Create(databaseName, TestDb.UserId))
        {
            url = await Create(dbContext).SynthesizeAsync("el gato", CancellationToken.None);
        }
        await using var otherUsersContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        var synthesizer = new FakeSpeechSynthesizer { Failure = new HttpRequestException("shouldn't be called") };

        var found = await Create(otherUsersContext, synthesizer).FindUrlAsync("el gato", CancellationToken.None);

        Assert.Equal(url, found);
        Assert.Empty(synthesizer.Calls);
    }

    [Theory]
    [InlineData("El gato")]
    [InlineData("el perro")]
    public async Task FindUrlAsync_KeepsEachTextsAudioApart(string other)
    {
        await using var dbContext = TestDb.Create();
        var cached = Create(dbContext);
        await cached.SynthesizeAsync("el gato", CancellationToken.None);

        Assert.Null(await cached.FindUrlAsync(other, CancellationToken.None));
    }

    [Fact]
    public async Task FindUrlAsync_KeepsEachVoicesAudioApart()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName);
        await Create(dbContext).SynthesizeAsync("el gato", CancellationToken.None);
        await using var otherVoicesContext = TestDb.Create(databaseName);

        Assert.Null(await Create(otherVoicesContext, voice: "es-ES-ElviraNeural").FindUrlAsync("el gato", CancellationToken.None));
    }

    [Fact]
    public async Task SynthesizeAsync_KeepsTheAudio_WhenAnotherRequestCachedTheTextMeanwhile()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName, TestDb.UserId, new UniqueIndexInterceptor(async () =>
        {
            await using var other = TestDb.Create(databaseName);
            await Create(other).SynthesizeAsync("el gato", CancellationToken.None);
        }));
        var store = new FakeImageStore();

        var url = await Create(dbContext, store: store).SynthesizeAsync("el gato", CancellationToken.None);

        Assert.Equal(Assert.Single(store.Saved).Url, url);
    }

    [Fact]
    public async Task SynthesizeAsync_KeepsNothing_WhenReadingFails()
    {
        await using var dbContext = TestDb.Create();
        var store = new FakeImageStore();
        var synthesizer = new FakeSpeechSynthesizer { Failure = new HttpRequestException("boom") };

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            Create(dbContext, synthesizer, store).SynthesizeAsync("el gato", CancellationToken.None));

        Assert.Empty(store.Saved);
        Assert.Equal(0, await dbContext.GeneratedAudio.CountAsync());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task IsAvailable_IsTheSynthesizers(bool available)
    {
        await using var dbContext = TestDb.Create();

        Assert.Equal(available, Create(dbContext, new FakeSpeechSynthesizer { IsAvailable = available }).IsAvailable);
    }

    private static CachedSpeechSynthesizer Create(
        FlashCardDbContext dbContext,
        FakeSpeechSynthesizer? synthesizer = null,
        FakeImageStore? store = null,
        string voice = "es-MX-DaliaNeural")
    {
        return new CachedSpeechSynthesizer(
            synthesizer ?? new FakeSpeechSynthesizer(),
            store ?? new FakeImageStore(),
            dbContext,
            Options.Create(new SpeechOptions { Voice = voice }),
            NullLogger<CachedSpeechSynthesizer>.Instance);
    }
}
