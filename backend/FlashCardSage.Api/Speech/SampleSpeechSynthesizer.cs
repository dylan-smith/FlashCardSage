namespace FlashCardSage.Api.Speech;

// Reads every phrase as the same short silence, for the E2E tests (SpeechOptions.UseSampleAudio), so their audio goes
// through the real cache and store without Azure Speech.
public class SampleSpeechSynthesizer : ISpeechSynthesizer
{
    // How many frames of silence: a second and a half or so, long enough for a test to see it playing.
    private const int Frames = 60;

    // An MPEG-1 Layer III frame at 128 kbps and 44.1 kHz, mono, is 417 bytes. The four-byte header says so, and a frame
    // whose side info and main data are all zero decodes as silence.
    private static readonly byte[] Frame = [0xFF, 0xFB, 0x90, 0xC0, .. new byte[413]];

    public static readonly byte[] Audio = [.. Enumerable.Range(0, Frames).SelectMany(_ => Frame)];

    public bool IsAvailable => true;

    public Task<SynthesizedSpeech> SynthesizeAsync(string text, CancellationToken cancellationToken)
    {
        return Task.FromResult(new SynthesizedSpeech(SynthesizedSpeech.Mp3ContentType, Audio));
    }
}
