using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Speech;

// Keeps the audio of every phrase the speech service reads, so a phrase is only paid for the first time anyone asks
// to hear it. A phrase sounds the same for everyone in a given voice, so like translations the rows are shared by
// every user, keyed by the voice, its speed and the text exactly as it's on the card. The audio itself goes in the
// image store, which the browser plays it from, under a name made from its content.
//
// The text is user-provided, so like the controller, this never logs it (log-forging).
public class CachedSpeechSynthesizer(
    ISpeechSynthesizer synthesizer,
    IImageStore imageStore,
    FlashCardDbContext dbContext,
    IOptions<SpeechOptions> options,
    ILogger<CachedSpeechSynthesizer> logger)
{
    private readonly string voice = options.Value.Voice;

    // Whether a phrase that hasn't been read yet can be.
    public bool IsAvailable => synthesizer.IsAvailable;

    // The URL of the audio kept for the text in the voice, read slowly or not, or null when nobody has asked to hear it
    // that way yet.
    public async Task<string?> FindUrlAsync(string text, bool slow, CancellationToken cancellationToken)
    {
        var rate = SpeakingRate(slow);
        var cached = await dbContext.GeneratedAudio
            .AsNoTracking()
            .FirstOrDefaultAsync(
                item => item.Voice == voice && item.SpeakingRate == rate && item.Text == text, cancellationToken);
        if (cached is null)
        {
            return null;
        }

        logger.LogInformation("Found the audio of {Length} characters in the cache", text.Length);
        return cached.AudioUrl;
    }

    // Has the text read, keeps the audio, and returns its URL. Throws as ISpeechSynthesizer.SynthesizeAsync does.
    public async Task<string> SynthesizeAsync(string text, bool slow, CancellationToken cancellationToken)
    {
        var speech = await synthesizer.SynthesizeAsync(text, slow, cancellationToken);

        // The audio has been paid for, so it's kept even if the user has moved on to another card.
        var url = await imageStore.SaveAsync(
            CardImage.ContentName(speech.Data.Span, speech.ContentType), speech.Data, CancellationToken.None);
        dbContext.GeneratedAudio.Add(new CachedAudio
        {
            Voice = voice,
            SpeakingRate = SpeakingRate(slow),
            Text = text,
            AudioUrl = url,
            CreatedAt = DateTimeOffset.UtcNow
        });
        if (await dbContext.TrySaveUniqueAsync(CancellationToken.None) is not null)
        {
            // Another request had the same text read in the meantime, which fails the unique index. Theirs is kept,
            // and this one, saved under a name of its own, is just as good.
            logger.LogInformation("The audio of {Length} characters was already cached", text.Length);
        }
        else
        {
            logger.LogInformation("Kept {Bytes} bytes of audio for {Length} characters", speech.Data.Length, text.Length);
        }

        return url;
    }

    // How fast the voice speaks, as a multiple of its normal speed, which the audio is kept under.
    private static decimal SpeakingRate(bool slow)
    {
        return slow ? SpeechOptions.SlowRate : CachedAudio.NormalSpeakingRate;
    }
}
