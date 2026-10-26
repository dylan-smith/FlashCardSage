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

    // Whether each call in Calls was to read its text slowly.
    public List<bool> SlowCalls { get; } = [];

    public Task<SynthesizedSpeech> SynthesizeAsync(string text, bool slow, CancellationToken cancellationToken)
    {
        Calls.Add(text);
        SlowCalls.Add(slow);
        return Failure is null ? Task.FromResult(Result) : Task.FromException<SynthesizedSpeech>(Failure);
    }
}
