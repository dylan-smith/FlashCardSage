namespace FlashCardSage.Api.Speech;

// Azure Speech settings, from the Speech configuration section. Audio is off without an endpoint and a key. Speech is
// part of the Azure AI Foundry resource (an AI Services account), so the key is the same one the pictures and
// suggestions use, on the Speech endpoint for the resource's region.
public class SpeechOptions
{
    public const string SectionName = "Speech";

    // How fast the voice speaks when the user asks to hear a phrase slowly, as a multiple of its normal speed (the SSML
    // prosody rate; Azure Speech takes 0.5 to 2). Slow audio is cached under it (CachedAudio.SpeakingRate), so changing
    // it starts afresh.
    public const decimal SlowRate = 0.70m;

    // The Speech endpoint for the resource's region, e.g. https://westus3.tts.speech.microsoft.com/. Keys are scoped
    // to their region, so a key only works on its own region's endpoint.
    public string Endpoint { get; set; } = string.Empty;

    public string Key { get; set; } = string.Empty;

    // The neural voice that reads the Spanish (see https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts).
    // Every voice reads a whole phrase or sentence with natural intonation, not word by word.
    public string Voice { get; set; } = "es-MX-DaliaNeural";

    // The voice's language and region, which its name starts with (es-MX for es-MX-DaliaNeural), for the SSML.
    public string Locale
    {
        get
        {
            var parts = Voice.Split('-');
            return parts.Length >= 2 ? $"{parts[0]}-{parts[1]}" : Voice;
        }
    }

    // Makes every phrase the same short silent MP3 instead of calling Azure Speech (see SampleSpeechSynthesizer), for
    // the E2E tests, which set it in playwright.config.ts. Nothing deployed sets it.
    public bool UseSampleAudio { get; set; }

    // False when no speech service is set up, e.g. in local development and E2E tests.
    public bool IsAvailable => !string.IsNullOrWhiteSpace(Endpoint) && !string.IsNullOrWhiteSpace(Key);
}
