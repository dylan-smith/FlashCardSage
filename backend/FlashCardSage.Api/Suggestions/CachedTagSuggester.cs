using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// Keeps the new tags the suggester last suggested for each of the user's requests (see SuggestionCache), so opening
// the Tags page again with nothing changed shows the same suggestions. A request describes the user's tags with their
// newest cards, and their newest untagged cards, so changing those asks the model again. Asking for more (with names
// to exclude) always asks the model, and its answer replaces the kept one. The tags that fit a card being typed aren't
// kept, since the card is new each time.
public class CachedTagSuggester(
    ITagSuggester suggester,
    FlashCardDbContext dbContext,
    ILogger<CachedTagSuggester> logger)
{
    public bool IsAvailable => suggester.IsAvailable;

    // The suggester's new tags for the request (see ITagSuggester.SuggestNewAsync), the kept ones unless there are
    // names to exclude. Throws as ITagSuggester.SuggestNewAsync does, and then nothing is kept.
    public Task<IReadOnlyList<string>> SuggestNewAsync(
        IReadOnlyList<Tag> tags,
        IReadOnlyList<FlashCard> untagged,
        IReadOnlyList<string> exclude,
        int count,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(exclude);

        return SuggestionCache.GetOrSuggestAsync<CachedTagSuggestions, string>(
            dbContext,
            dbContext.TagSuggestions,
            PromptHash(tags, untagged, count),
            refresh: exclude.Count > 0,
            () => suggester.SuggestNewAsync(tags, untagged, exclude, count, cancellationToken),
            logger,
            cancellationToken);
    }

    // The hash of the request with nothing excluded, which is what opening the page asks.
    public static string PromptHash(IReadOnlyList<Tag> tags, IReadOnlyList<FlashCard> untagged, int count)
    {
        return SuggestionCache.PromptHash(
            FoundryTagSuggester.NewTagInstructions, FoundryTagSuggester.NewTagsRequest(tags, untagged, [], count));
    }
}
