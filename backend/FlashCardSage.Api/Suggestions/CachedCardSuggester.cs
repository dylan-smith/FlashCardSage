using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// Keeps the cards the suggester last suggested for each of the user's requests (see SuggestionCache), so opening the
// cards page again with nothing changed shows the same suggestions. A request describes the user's cards and their
// tags, so adding, changing or deleting a card asks the model again. Asking for more (with cards to exclude) always
// asks the model, and its answer replaces the kept one, so the page opens on the newest suggestions.
public class CachedCardSuggester(
    ICardSuggester suggester,
    FlashCardDbContext dbContext,
    ILogger<CachedCardSuggester> logger)
{
    public bool IsAvailable => suggester.IsAvailable;

    // The suggester's cards for the request (see ICardSuggester.SuggestAsync), the kept ones unless there are cards to
    // exclude. Throws as ICardSuggester.SuggestAsync does, and then nothing is kept.
    public Task<IReadOnlyList<CardSuggestion>> SuggestAsync(
        IReadOnlyList<FlashCard> cards,
        FlashCard? relatedTo,
        Tag? tag,
        IReadOnlyList<string> exclude,
        int count,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(exclude);

        return SuggestionCache.GetOrSuggestAsync<CachedCardSuggestions, CardSuggestion>(
            dbContext,
            dbContext.CardSuggestions,
            PromptHash(cards, relatedTo, tag, count),
            refresh: exclude.Count > 0,
            () => suggester.SuggestAsync(cards, relatedTo, tag, exclude, count, cancellationToken),
            logger,
            cancellationToken);
    }

    // The hash of the request with nothing excluded, which is what opening the page asks.
    public static string PromptHash(IReadOnlyList<FlashCard> cards, FlashCard? relatedTo, Tag? tag, int count)
    {
        return SuggestionCache.PromptHash(
            FoundryCardSuggester.Instructions, FoundryCardSuggester.Request(cards, relatedTo, tag, [], count));
    }
}
