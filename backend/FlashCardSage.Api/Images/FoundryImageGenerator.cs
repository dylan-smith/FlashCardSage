using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json.Serialization;
using FlashCardSage.Api.Observability;
using FlashCardSage.Api.Suggestions.Foundry;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Images;

// Calls the Black Forest Labs API of an Azure AI Foundry resource for its deployment of a FLUX image model
// (FLUX.2-pro). The picture comes back as base64, as a JPEG of a megapixel, which is the least the model bills for
// and plenty for a thumbnail or a practice card. Every call, with its prompt, is recorded for PostHog's AI
// observability as card_picture.
public class FoundryImageGenerator(
    HttpClient httpClient, IOptions<ImageGenerationOptions> options, IAiUsage aiUsage) : IImageGenerator
{
    public const string Feature = "card_picture";

    public const string ContentType = "image/jpeg";

    // A megapixel, square.
    public const int Size = 1024;

    // The error codes the service answers with when a safety system refuses the words or the picture.
    private static readonly string[] ContentFilterCodes =
    [
        "contentFilter", "content_policy_violation", "content_moderation", "content_safety_violation",
        "ResponsibleAIPolicyViolation"
    ];

    private readonly ImageGenerationOptions options = options.Value;

    public bool IsAvailable => options.IsAvailable;

    public async Task<GeneratedImage> GenerateAsync(string spanish, string english, CancellationToken cancellationToken)
    {
        // The deployment is named after its model, which is also the model's path in the API.
        var url = $"{options.Endpoint.TrimEnd('/')}/providers/blackforestlabs/v1/{options.Deployment}"
            + $"?api-version={options.ApiVersion}";
        var prompt = Prompt(spanish, english);
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonBody.Create(new GenerationRequest(options.Deployment, prompt))
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Key);

        var started = Stopwatch.GetTimestamp();
        AiGeneration Generation()
        {
            return new(Feature, options.Deployment, options.Endpoint, [new AiMessage("user", prompt)],
                Stopwatch.GetElapsedTime(started));
        }

        using var response = await aiUsage.SendAsync(httpClient, request, Generation, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var error = await response.Content.ReadAsStringAsync(cancellationToken);
            Exception failure;
            if (IsContentFiltered(error))
            {
                failure = new ImageContentFilteredException("The image generator's safety system refused the words.");
            }
            else
            {
                // The service's error code says what went wrong (its message might echo the words, so it's left out).
                var code = FoundryErrors.Code(error) is { } errorCode ? $" ({errorCode})" : string.Empty;
                failure = new HttpRequestException(
                    $"The image generator answered {(int)response.StatusCode}{code}.", null, response.StatusCode);
            }

            aiUsage.Record(Generation() with { HttpStatus = (int)response.StatusCode, Error = failure.Message });
            throw failure;
        }

        var result = await response.Content.ReadFromJsonAsync<GenerationResult>(cancellationToken);
        var generation = Generation() with { HttpStatus = (int)response.StatusCode };
        if (result?.Data is [{ Base64: { Length: > 0 } base64 }, ..])
        {
            var image = Convert.FromBase64String(base64);
            aiUsage.Record(generation with { ImageBytes = image.Length });
            return new GeneratedImage(ContentType, image);
        }

        Exception missing = result?.Data is not null
            // The safety system sometimes answers with success but leaves the picture out (e.g. "to cut").
            ? new ImageContentFilteredException("The image generator's safety system left out the picture.")
            : new HttpRequestException("The image generator returned no picture.");
        aiUsage.Record(generation with { Error = missing.Message });
        throw missing;
    }

    // What the model is asked for. The English side describes the idea best, and the model tends to write any
    // word it's handed into the picture, so the Spanish is only used when there's no English yet (either side can
    // be blank while the user is typing).
    public static string Prompt(string spanish, string english)
    {
        ArgumentNullException.ThrowIfNull(spanish);
        ArgumentNullException.ThrowIfNull(english);
        var subject = english.Length > 0 ? english : $"the Spanish word {spanish}";
        return "A simple, friendly, flat illustration for a language-learning flash card, showing the idea of: "
            + $"{subject}. The picture contains no writing at all: no text, letters, words, labels, captions or "
            + "watermarks.";
    }

    // Whether an error response is a safety system's, by its code.
    private static bool IsContentFiltered(string body)
    {
        return FoundryErrors.Code(body) is { } code && ContentFilterCodes.Contains(code, StringComparer.OrdinalIgnoreCase);
    }

    private sealed record GenerationRequest(
        [property: JsonPropertyName("model")] string Model,
        [property: JsonPropertyName("prompt")] string Prompt,
        [property: JsonPropertyName("width")] int Width = Size,
        [property: JsonPropertyName("height")] int Height = Size,
        [property: JsonPropertyName("output_format")] string OutputFormat = "jpeg",
        [property: JsonPropertyName("num_images")] int NumImages = 1);

    private sealed record GenerationResult([property: JsonPropertyName("data")] IReadOnlyList<GeneratedData>? Data);

    private sealed record GeneratedData([property: JsonPropertyName("b64_json")] string? Base64);
}
