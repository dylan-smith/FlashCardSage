using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;

namespace FlashCardSage.Api.Tests.Fakes;

// Answers every request with the result, or fails it with the failure, and keeps what it was last asked.
internal sealed class FakeCardSuggester : ICardSuggester
{
    public bool IsAvailable { get; init; } = true;

    public IReadOnlyList<CardSuggestion> Result { get; set; } = [];

    public Exception? Failure { get; set; }

    public int CallCount { get; private set; }

    public IReadOnlyList<FlashCard>? Cards { get; private set; }

    public FlashCard? RelatedTo { get; private set; }

    public Tag? Tag { get; private set; }

    public IReadOnlyList<string>? Exclude { get; private set; }

    public int? Count { get; private set; }

    public Task<IReadOnlyList<CardSuggestion>> SuggestAsync(
        IReadOnlyList<FlashCard> cards,
        FlashCard? relatedTo,
        Tag? tag,
        IReadOnlyList<string> exclude,
        int count,
        CancellationToken cancellationToken)
    {
        CallCount++;
        Cards = cards;
        RelatedTo = relatedTo;
        Tag = tag;
        Exclude = exclude;
        Count = count;
        return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<CardSuggestion>>(Failure);
    }
}
