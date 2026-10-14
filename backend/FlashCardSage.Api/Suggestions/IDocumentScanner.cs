using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

public interface IDocumentScanner
{
    // False when no suggestion service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // Cards for the words and phrases in a document's text that are most worth learning, most useful first, at most
    // count of them. cards are the user's cards for words in the text, which are to be left out, though as the service
    // answers, the cards can still include them. Throws HttpRequestException if the service fails.
    Task<IReadOnlyList<CardSuggestion>> ScanAsync(
        string text, IReadOnlyList<FlashCard> cards, int count, CancellationToken cancellationToken);
}
