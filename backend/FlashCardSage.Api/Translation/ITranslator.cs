namespace FlashCardSage.Api.Translation;

public interface ITranslator
{
    // False when no translation service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // Translates Spanish into English, or English into Spanish. Throws HttpRequestException if the service fails.
    Task<TranslationResult> TranslateAsync(string text, Language from, CancellationToken cancellationToken);
}

// The likeliest translation, and for a single word its other meanings, most common first.
public record TranslationResult(string Text, IReadOnlyList<string> Alternatives);
