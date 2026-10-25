using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;

namespace FlashCardSage.Api.Tests.Fakes;

// Answers every request with the result, or fails it with the failure, and keeps what it was last asked.
internal sealed class FakeSentenceGenerator : ISentenceGenerator
{
    public bool IsAvailable { get; init; } = true;

    public IReadOnlyList<PracticeSentence> Result { get; set; } = [];

    public Exception? Failure { get; set; }

    public int CallCount { get; private set; }

    public IReadOnlyList<FlashCard>? Cards { get; private set; }

    public int? Count { get; private set; }

    public Task<IReadOnlyList<PracticeSentence>> GenerateAsync(
        IReadOnlyList<FlashCard> cards, int count, CancellationToken cancellationToken)
    {
        CallCount++;
        Cards = cards;
        Count = count;
        return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<PracticeSentence>>(Failure);
    }
}
