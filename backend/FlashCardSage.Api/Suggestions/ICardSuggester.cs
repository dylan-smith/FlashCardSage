using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

public interface ICardSuggester
{
    // False when no suggestion service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // New cards that go with the user's cards, as the service suggests them, which can include ones the user already
    // has. Throws HttpRequestException if the service fails.
    Task<IReadOnlyList<CardSuggestion>> SuggestAsync(
        IReadOnlyList<FlashCard> cards, int count, CancellationToken cancellationToken);
}

// A card the user doesn't have yet.
public record CardSuggestion(string Spanish, string English);
