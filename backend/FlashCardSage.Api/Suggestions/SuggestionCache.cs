using System.Security.Cryptography;
using System.Text;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Suggestions;

// Keeps what the suggestion model last suggested for each of the user's prompts, so opening a page again with nothing
// changed shows the same suggestions instead of paying for new ones. A prompt describes the user's cards and tags, so
// changing them asks the model again. Asking for fresh suggestions (refresh) always asks the model, and the new ones
// replace the kept ones. Only a user's most recent prompts are kept, since an older one only comes back if their cards
// go back to how they were.
//
// The suggestions are made from the user's cards, so this never logs them (log-forging).
public static class SuggestionCache
{
    public const int PromptHashLength = 64;

    // How many of a user's prompts are kept, of each kind.
    public const int MaxKept = 20;

    // The suggestions kept in cache for the prompt with this hash, unless refresh asks for new ones, or else suggest's,
    // which are then kept (unless there are none). Throws as suggest does, and then nothing is kept.
    public static async Task<IReadOnlyList<TItem>> GetOrSuggestAsync<TEntity, TItem>(
        FlashCardDbContext dbContext,
        DbSet<TEntity> cache,
        string hash,
        bool refresh,
        Func<Task<IReadOnlyList<TItem>>> suggest,
        ILogger logger,
        CancellationToken cancellationToken)
        where TEntity : class, ICachedSuggestions<TItem>, new()
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(cache);
        ArgumentNullException.ThrowIfNull(suggest);

        var cached = await cache.FirstOrDefaultAsync(item => item.PromptHash == hash, cancellationToken);
        if (cached is not null && !refresh)
        {
            logger.LogInformation("Found {Count} suggestions in the cache", cached.Suggestions.Count);
            return cached.Suggestions;
        }

        var suggestions = await suggest();
        if (suggestions.Count == 0)
        {
            // Nothing worth showing again, so the next request asks afresh.
            return suggestions;
        }

        if (cached is null)
        {
            cached = new TEntity { PromptHash = hash };
            cache.Add(cached);
        }
        cached.Suggestions = [.. suggestions];
        cached.CreatedAt = DateTimeOffset.UtcNow;

        var keptId = cached.Id;
        cache.RemoveRange(await cache
            .Where(item => item.Id != keptId)
            .OrderByDescending(item => item.CreatedAt)
            .ThenByDescending(item => item.Id)
            .Skip(MaxKept - 1)
            .ToListAsync(CancellationToken.None));

        // The suggestions have been paid for, so they're kept even if the user has left the page.
        if (await dbContext.TrySaveUniqueAsync(CancellationToken.None) is not null)
        {
            // Another request kept suggestions for the same prompt in the meantime, which fails the unique index.
            // Theirs are kept, and these are just as good.
            logger.LogInformation("Suggestions for the prompt were already cached");
        }

        return suggestions;
    }

    // What suggestions are kept by: the instructions and the request the suggester sends, so a change to either asks
    // afresh.
    public static string PromptHash(string instructions, string request)
    {
        var prompt = instructions + "\n" + request;
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(prompt)));
    }
}
