namespace FlashCardSage.Api.Models;

// A translation the API got from Azure AI Translator, kept so the same text is never paid for twice. The same text
// always translates the same way, so unlike everything else in the database it belongs to no user: every user's
// translations go through it (see CachedTranslator). It's never returned itself.
public class CachedTranslation
{
    public int Id { get; set; }

    public Language FromLanguage { get; set; }

    // The trimmed text as typed. Its case matters, since the translation's case follows it.
    public string Text { get; set; } = string.Empty;

    public string Translation { get; set; } = string.Empty;

    // The word's other meanings, when there are any, most common first.
    public List<string> Alternatives { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }
}
