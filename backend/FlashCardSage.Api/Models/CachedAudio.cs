namespace FlashCardSage.Api.Models;

// The spoken audio of a phrase the API got from the speech service, kept so the same phrase is never paid for twice.
// A phrase sounds the same for everyone in a given voice, so like a cached translation it belongs to no user: every
// user's audio goes through it (see CachedSpeechSynthesizer). It's never returned itself; the browser plays the audio
// from its URL.
public class CachedAudio
{
    public const int MaxVoiceLength = 64;

    public int Id { get; set; }

    // The voice's name, e.g. es-MX-DaliaNeural, so a change of voice starts afresh.
    public string Voice { get; set; } = string.Empty;

    // The phrase as it's on the card. Its case matters, since the voice might read it differently.
    public string Text { get; set; } = string.Empty;

    // The audio in the image store, which every card with the phrase shares, so it's never removed.
    public string AudioUrl { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }
}
