using System.Net.Http.Headers;
using System.Security;
using System.Text;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Speech;

// Calls the Azure Speech text to speech REST API with the resource's key. The text goes in SSML, which names the
// voice, and the audio comes back as the body of the response.
public class AzureSpeechSynthesizer(HttpClient httpClient, IOptions<SpeechOptions> options) : ISpeechSynthesizer
{
    // A compact MP3 the browser plays straight from the store. 24 kHz is the voices' native sample rate.
    public const string OutputFormat = "audio-24khz-48kbitrate-mono-mp3";

    private readonly SpeechOptions options = options.Value;

    public bool IsAvailable => options.IsAvailable;

    public async Task<SynthesizedSpeech> SynthesizeAsync(string text, bool slow, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{options.Endpoint.TrimEnd('/')}/cognitiveservices/v1")
        {
            // A StringContent has a known length, so the request carries Content-Length rather than being chunked.
            Content = new StringContent(Ssml(text, slow), Encoding.UTF8)
        };
        request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/ssml+xml");
        request.Headers.Add("Ocp-Apim-Subscription-Key", options.Key);
        request.Headers.Add("X-Microsoft-OutputFormat", OutputFormat);
        // The service requires one, and it's how the resource's usage names the caller.
        request.Headers.UserAgent.ParseAdd("FlashCardSage");

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var audio = await response.Content.ReadAsByteArrayAsync(cancellationToken);
        return audio.Length > 0
            ? new SynthesizedSpeech(SynthesizedSpeech.Mp3ContentType, audio)
            : throw new HttpRequestException("The speech service returned no audio.");
    }

    // The SSML that has the voice read the text. The text is the user's, so it's escaped, and can't add markup of its
    // own. To read it slowly, the voice is given a slower prosody rate, so it speaks the words slowly itself, with
    // longer sounds and pauses at its natural pitch, rather than the audio being stretched.
    public string Ssml(string text, bool slow = false)
    {
        var words = SecurityElement.Escape(text);
        if (slow)
        {
            words = $"<prosody rate='{SpeechOptions.SlowRate}'>{words}</prosody>";
        }

        return $"<speak version='1.0' xml:lang='{options.Locale}'><voice name='{options.Voice}'>{words}</voice></speak>";
    }
}
