using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// Keeps the new tags the suggester last suggested for each of the user's requests (see SuggestionCache), so opening
// the Tags page again with nothing changed shows the same suggestions. A request describes the user's tags with their
// newest cards, and their newest untagged cards, so changing those asks the model again. The tags that fit a card
// being typed aren't kept, since the card is new each time.
public class CachedTagSuggester(
    ITagSuggester suggester,
    FlashCardDbContext dbContext,
    ILogger<CachedTagSuggester> logger)
{
    public bool IsAvailable => suggester.IsAvailable;

    // The suggester's new tags for the request (see ITagSuggester.SuggestNewAsync), the kept ones unless refresh asks
    // for new ones. Throws as ITagSuggester.SuggestNewAsync does, and then nothing is kept.
    public Task<IReadOnlyList<string>> SuggestNewAsync(
        IReadOnlyList<Tag> tags,
        IReadOnlyList<FlashCard> untagged,
        int count,
        bool refresh,
        CancellationToken cancellationToken)
    {
        return SuggestionCache.GetOrSuggestAsync<CachedTagSuggestions, string>(
            dbContext,
            dbContext.TagSuggestions,
            PromptHash(tags, untagged, count),
            refresh,
            () => suggester.SuggestNewAsync(tags, untagged, count, cancellationToken),
            logger,
            cancellationToken);
    }

    public static string PromptHash(IReadOnlyList<Tag> tags, IReadOnlyList<FlashCard> untagged, int count)
    {
        return SuggestionCache.PromptHash(
            FoundryTagSuggester.NewTagInstructions, FoundryTagSuggester.NewTagsRequest(tags, untagged, count));
    }
}
