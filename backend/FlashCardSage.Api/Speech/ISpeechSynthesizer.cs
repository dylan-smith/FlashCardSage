namespace FlashCardSage.Api.Speech;

public interface ISpeechSynthesizer
{
    // False when no speech service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // Reads the Spanish text aloud, as a phrase or sentence with natural intonation. Throws HttpRequestException when
    // the service fails.
    Task<SynthesizedSpeech> SynthesizeAsync(string text, CancellationToken cancellationToken);
}

public record SynthesizedSpeech(string ContentType, ReadOnlyMemory<byte> Data)
{
    // Every synthesizer makes MP3s, which every browser plays.
    public const string Mp3ContentType = "audio/mpeg";
}
