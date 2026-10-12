using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Translation;

// Calls the Azure AI Translator text API (v3). The resource is global, so requests don't need a region header.
public class AzureTranslator(HttpClient httpClient, IOptions<TranslatorOptions> options) : ITranslator
{
    private readonly TranslatorOptions options = options.Value;

    public bool IsAvailable => !string.IsNullOrWhiteSpace(options.Key);

    public async Task<string> TranslateAsync(string text, Language from, CancellationToken cancellationToken)
    {
        var (fromCode, toCode) = from == Language.Spanish ? ("es", "en") : ("en", "es");
        var url = $"{options.Endpoint.TrimEnd('/')}/translate?api-version=3.0&from={fromCode}&to={toCode}";

        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(new[] { new TranslateText(text) })
        };
        request.Headers.Add("Ocp-Apim-Subscription-Key", options.Key);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();

        var results = await response.Content.ReadFromJsonAsync<TranslateResult[]>(cancellationToken);
        return results is [{ Translations: [var first, ..] }, ..]
            ? first.Text
            : throw new HttpRequestException("The translator returned no translation.");
    }

    private sealed record TranslateText(string Text);

    private sealed record TranslateResult(IReadOnlyList<TranslationText> Translations);

    private sealed record TranslationText(string Text);
}
