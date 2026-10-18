using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Translation;

// Keeps every translation in the database, so a text is only sent to Azure AI Translator (which charges per
// character) the first time anyone types it. The same text always translates the same way, so the rows are shared
// by every user, keyed by the language and the text exactly as typed (its case decides the translation's).
//
// The text is user-provided, so like the controller, this never logs it (log-forging).
public class CachedTranslator(ITranslator translator, FlashCardDbContext dbContext, ILogger<CachedTranslator> logger)
    : ITranslator
{
    public bool IsAvailable => translator.IsAvailable;

    public async Task<TranslationResult> TranslateAsync(string text, Language from, CancellationToken cancellationToken)
    {
        var cached = await dbContext.Translations
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.FromLanguage == from && item.Text == text, cancellationToken);
        if (cached is not null)
        {
            logger.LogInformation("Found the translation of {Length} characters from {Language} in the cache", text.Length, from);
            return new TranslationResult(cached.Translation, cached.Alternatives);
        }

        var result = await translator.TranslateAsync(text, from, cancellationToken);

        dbContext.Translations.Add(new CachedTranslation
        {
            FromLanguage = from,
            Text = text,
            Translation = result.Text,
            Alternatives = [.. result.Alternatives],
            CreatedAt = DateTimeOffset.UtcNow
        });
        // The translation has been paid for, so it's kept even if the user has typed on and the request is no longer
        // wanted.
        if (await dbContext.TrySaveUniqueAsync(CancellationToken.None) is not null)
        {
            // Another request translated the same text in the meantime, which fails the unique index. Theirs is
            // kept, and this one is just as good.
            logger.LogInformation("The translation of {Length} characters from {Language} was already cached", text.Length, from);
        }

        return result;
    }
}
