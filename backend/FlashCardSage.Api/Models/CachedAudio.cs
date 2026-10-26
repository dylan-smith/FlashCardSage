namespace FlashCardSage.Api.Models;

// The spoken audio of a phrase the API got from the speech service, kept so the same phrase is never paid for twice.
// A phrase sounds the same for everyone in a given voice, so like a cached translation it belongs to no user: every
// user's audio goes through it (see CachedSpeechSynthesizer). It's never returned itself; the browser plays the audio
// from its URL.
public class CachedAudio
{
    public const int MaxVoiceLength = 64;

    // The voice's normal speed.
    public const decimal NormalSpeakingRate = 1.00m;

    // Long enough for a practice sentence, as well as a card's words.
    public const int MaxTextLength = SentencePracticeResult.MaxSentenceLength;

    public int Id { get; set; }

    // The voice's name, e.g. es-MX-DaliaNeural, so a change of voice starts afresh.
    public string Voice { get; set; } = string.Empty;

    // How fast the voice read it, as a multiple of its normal speed: 1.00, or SpeechOptions.SlowRate when it was asked
    // to speak slowly. A change of rate starts afresh too.
    public decimal SpeakingRate { get; set; } = NormalSpeakingRate;

    // The phrase as it's on the card. Its case matters, since the voice might read it differently.
    public string Text { get; set; } = string.Empty;

    // The audio in the image store, which every card with the phrase shares, so it's never removed.
    public string AudioUrl { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }
}
