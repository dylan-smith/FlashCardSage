using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

public interface ICardSuggester
{
    // False when no suggestion service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // New cards that go with the user's cards, as the service suggests them, which can include ones the user already
    // has. With relatedTo, one of the cards (e.g. one just added), they're related to that card, and with tag, one of
    // the user's tags (e.g. the one whose cards they're looking at), they go under that tag. They're not the cards whose
    // Spanish is in exclude, which were already suggested, though as the service answers they can include them. Throws
    // HttpRequestException if the service fails.
    Task<IReadOnlyList<CardSuggestion>> SuggestAsync(
        IReadOnlyList<FlashCard> cards,
        FlashCard? relatedTo,
        Tag? tag,
        IReadOnlyList<string> exclude,
        int count,
        CancellationToken cancellationToken);
}

// A card the user doesn't have yet.
public record CardSuggestion(string Spanish, string English);
