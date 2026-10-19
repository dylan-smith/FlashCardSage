using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// Keeps the cards the suggester last suggested for each of the user's requests (see SuggestionCache), so opening the
// cards page again with nothing changed shows the same suggestions. A request describes the user's cards and their
// tags, so adding, changing or deleting a card asks the model again.
public class CachedCardSuggester(
    ICardSuggester suggester,
    FlashCardDbContext dbContext,
    ILogger<CachedCardSuggester> logger)
{
    public bool IsAvailable => suggester.IsAvailable;

    // The suggester's cards for the request (see ICardSuggester.SuggestAsync), the kept ones unless refresh asks for
    // new ones. Throws as ICardSuggester.SuggestAsync does, and then nothing is kept.
    public Task<IReadOnlyList<CardSuggestion>> SuggestAsync(
        IReadOnlyList<FlashCard> cards,
        FlashCard? relatedTo,
        Tag? tag,
        int count,
        bool refresh,
        CancellationToken cancellationToken)
    {
        return SuggestionCache.GetOrSuggestAsync<CachedCardSuggestions, CardSuggestion>(
            dbContext,
            dbContext.CardSuggestions,
            PromptHash(cards, relatedTo, tag, count),
            refresh,
            () => suggester.SuggestAsync(cards, relatedTo, tag, count, cancellationToken),
            logger,
            cancellationToken);
    }

    public static string PromptHash(IReadOnlyList<FlashCard> cards, FlashCard? relatedTo, Tag? tag, int count)
    {
        return SuggestionCache.PromptHash(
            FoundryCardSuggester.Instructions, FoundryCardSuggester.Request(cards, relatedTo, tag, count));
    }
}
