using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

public interface ITagSuggester
{
    // False when no suggestion service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // The names of the tags a card with these words belongs under, picked from tags, each with some of its cards (its
    // FlashCards) to show what the user puts under it. None when no tag fits. As the service answers, they can include
    // names that aren't in tags. Throws HttpRequestException if the service fails.
    Task<IReadOnlyList<string>> SuggestAsync(
        IReadOnlyList<string> spanish,
        IReadOnlyList<string> english,
        IReadOnlyList<Tag> tags,
        CancellationToken cancellationToken);
}
