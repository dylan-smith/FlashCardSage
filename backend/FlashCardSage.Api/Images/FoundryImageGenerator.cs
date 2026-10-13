using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Images;

// Calls the Black Forest Labs API of an Azure AI Foundry resource for its deployment of a FLUX image model
// (FLUX.2-pro). The picture comes back as base64, as a JPEG of a megapixel, which is the least the model bills for
// and plenty for a thumbnail or a practice card.
public class FoundryImageGenerator(HttpClient httpClient, IOptions<ImageGenerationOptions> options) : IImageGenerator
{
    public const string ContentType = "image/jpeg";

    // A megapixel, square.
    public const int Size = 1024;

    // The error codes the service answers with when a safety system refuses the words or the picture.
    private static readonly string[] ContentFilterCodes =
        ["contentFilter", "content_policy_violation", "content_moderation", "ResponsibleAIPolicyViolation"];

    private readonly ImageGenerationOptions options = options.Value;

    public bool IsAvailable => !string.IsNullOrWhiteSpace(options.Endpoint) && !string.IsNullOrWhiteSpace(options.Key);

    public async Task<GeneratedImage> GenerateAsync(string spanish, string english, CancellationToken cancellationToken)
    {
        // The deployment is named after its model, which is also the model's path in the API.
        var url = $"{options.Endpoint.TrimEnd('/')}/providers/blackforestlabs/v1/{options.Deployment}"
            + $"?api-version={options.ApiVersion}";
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(new GenerationRequest(options.Deployment, Prompt(spanish, english)))
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Key);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            if (IsContentFiltered(body))
            {
                throw new ImageContentFilteredException("The image generator's safety system refused the words.");
            }

            throw new HttpRequestException(
                $"The image generator answered {(int)response.StatusCode}.", null, response.StatusCode);
        }

        var result = await response.Content.ReadFromJsonAsync<GenerationResult>(cancellationToken);
        var image = result?.Data is [{ Base64: { Length: > 0 } base64 }, ..] ? Convert.FromBase64String(base64) : null;
        return image is null
            ? throw new HttpRequestException("The image generator returned no picture.")
            : new GeneratedImage(ContentType, image);
    }

    // What the model is asked for. Either side can be blank, since the user may not have typed both yet.
    public static string Prompt(string spanish, string english)
    {
        ArgumentNullException.ThrowIfNull(spanish);
        ArgumentNullException.ThrowIfNull(english);
        var subject = (spanish.Length, english.Length) switch
        {
            ( > 0, > 0) => $"the Spanish \"{spanish}\" (\"{english}\" in English)",
            ( > 0, _) => $"the Spanish \"{spanish}\"",
            _ => $"the English \"{english}\""
        };
        return "A simple, friendly illustration for a language-learning flash card, showing the meaning of "
            + $"{subject}. No text, letters, captions or watermarks.";
    }

    // Whether an error response is a safety system's. Its code is on the error, or on the error inside it.
    private static bool IsContentFiltered(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("error", out var error)
                && (HasContentFilterCode(error)
                    || (error.ValueKind == JsonValueKind.Object
                        && error.TryGetProperty("inner_error", out var innerError)
                        && HasContentFilterCode(innerError)));
        }
        catch (JsonException)
        {
            return false;
        }
    }

    private static bool HasContentFilterCode(JsonElement error)
    {
        return error.ValueKind == JsonValueKind.Object
            && error.TryGetProperty("code", out var code)
            && code.ValueKind == JsonValueKind.String
            && ContentFilterCodes.Contains(code.GetString(), StringComparer.OrdinalIgnoreCase);
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
