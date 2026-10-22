using FlashCardSage.Api.Speech;

namespace FlashCardSage.Api.Tests.Fakes;

// Stands in for the speech service: reads every text as the same audio, or fails, and remembers the texts it was given.
internal sealed class FakeSpeechSynthesizer : ISpeechSynthesizer
{
    public static readonly byte[] Mp3 = [0xFF, 0xFB, 0x90, 0xC0, 0x00, 0x00, 0x00, 0x00];

    public bool IsAvailable { get; init; } = true;

    public SynthesizedSpeech Result { get; set; } = new(SynthesizedSpeech.Mp3ContentType, Mp3);

    public Exception? Failure { get; init; }

    public List<string> Calls { get; } = [];

    public Task<SynthesizedSpeech> SynthesizeAsync(string text, CancellationToken cancellationToken)
    {
        Calls.Add(text);
        return Failure is null ? Task.FromResult(Result) : Task.FromException<SynthesizedSpeech>(Failure);
    }
}
