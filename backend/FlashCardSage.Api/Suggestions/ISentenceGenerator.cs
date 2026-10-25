using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

public interface ISentenceGenerator
{
    // False when no sentence service is set up, e.g. in local development and E2E tests.
    bool IsAvailable { get; }

    // Sentences that use the user's cards, as the service writes them, which can be blank, too long or name ids that
    // aren't the cards' (see NewSentences). Throws HttpRequestException if the service fails.
    Task<IReadOnlyList<PracticeSentence>> GenerateAsync(
        IReadOnlyList<FlashCard> cards, int count, CancellationToken cancellationToken);
}

// A sentence to practice, in Spanish and English, with the ids of the cards it uses.
public record PracticeSentence(string Spanish, string English, IReadOnlyList<int> CardIds);
