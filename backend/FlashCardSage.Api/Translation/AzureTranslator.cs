using System.Text.RegularExpressions;
using FlashCardSage.Api.Models;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Translation;

// Calls the Azure AI Translator text API (v3). The resource is global, so requests don't need a region header.
//
// A single word goes to the dictionary lookup, which ranks a word's meanings by how common they are: translate has no
// context for a lone word and can pick a rare meaning (chair is "presidente", not "silla"). Anything the dictionary
// doesn't know, such as a phrase, is translated.
public partial class AzureTranslator(HttpClient httpClient, IOptions<TranslatorOptions> options) : ITranslator
{
    // The most other meanings to offer, so the list stays short enough to read at a glance.
    public const int MaxAlternatives = 4;

    private readonly TranslatorOptions options = options.Value;

    public bool IsAvailable => !string.IsNullOrWhiteSpace(options.Key);

    public async Task<TranslationResult> TranslateAsync(string text, Language from, CancellationToken cancellationToken)
    {
        var (fromCode, toCode) = from == Language.Spanish ? ("es", "en") : ("en", "es");
        var to = from == Language.Spanish ? Language.English : Language.Spanish;
        var query = $"api-version=3.0&from={fromCode}&to={toCode}";

        if (!text.Any(char.IsWhiteSpace))
        {
            var lookups = await PostAsync<LookupResult[]>($"dictionary/lookup?{query}", text, cancellationToken);
            var meanings = (lookups is [var lookup, ..] ? lookup.Translations : [])
                .OrderByDescending(meaning => meaning.Confidence)
                .Select(meaning => MatchCase(text, to, meaning.DisplayTarget))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (meanings.Count > 0)
            {
                return new TranslationResult(meanings[0], meanings.Skip(1).Take(MaxAlternatives).ToList());
            }
        }

        var results = await PostAsync<TranslateResult[]>($"translate?{query}", text, cancellationToken);
        return results is [{ Translations: [var first, ..] }, ..]
            ? new TranslationResult(MatchCase(text, to, first.Text), [])
            : throw new HttpRequestException("The translator returned no translation.");
    }

    private async Task<T?> PostAsync<T>(string path, string text, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, $"{options.Endpoint.TrimEnd('/')}/{path}")
        {
            Content = JsonContent.Create(new[] { new TranslateText(text) })
        };
        request.Headers.Add("Ocp-Apim-Subscription-Key", options.Key);

        using var response = await httpClient.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<T>(cancellationToken);
    }

    // The translator capitalizes a translation's first letter, and often every word of a short phrase as if it were
    // a title ("el perro negro" is "The Black Dog"). Cards are typed in lowercase, so a translation of text with no
    // capitals is lowercased too, apart from the English "I". When the text has a capital somewhere else, only the
    // first letter is matched, and text that starts with a capital, such as a name, is left as translated.
    private static string MatchCase(string text, Language to, string translation)
    {
        if (translation.Length == 0 || !char.IsLower(text[0]))
        {
            return translation;
        }
        var lowercase = text.Any(char.IsUpper)
            ? char.ToLowerInvariant(translation[0]) + translation[1..]
            : translation.ToLowerInvariant();
        return to == Language.English ? EnglishI().Replace(lowercase, "I") : lowercase;
    }

    [GeneratedRegex(@"\bi\b")]
    private static partial Regex EnglishI();

    private sealed record TranslateText(string Text);

    private sealed record TranslateResult(IReadOnlyList<TranslationText> Translations);

    private sealed record TranslationText(string Text);

    private sealed record LookupResult(IReadOnlyList<LookupMeaning> Translations);

    private sealed record LookupMeaning(string DisplayTarget, double Confidence);
}
