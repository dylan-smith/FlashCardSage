using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;

namespace FlashCardSage.Api.Tests.Fakes;

// Answers every request with the result, or fails it with the failure, and keeps what it was last asked.
internal sealed class FakeTagSuggester : ITagSuggester
{
    public bool IsAvailable { get; init; } = true;

    public IReadOnlyList<string> Result { get; set; } = [];

    public Exception? Failure { get; set; }

    public IReadOnlyList<string>? Spanish { get; private set; }

    public IReadOnlyList<string>? English { get; private set; }

    public IReadOnlyList<Tag>? Tags { get; private set; }

    public IReadOnlyList<FlashCard>? Untagged { get; private set; }

    public IReadOnlyList<string>? Exclude { get; private set; }

    public int? Count { get; private set; }

    // How many times new tags were asked for.
    public int NewCallCount { get; private set; }

    public Task<IReadOnlyList<string>> SuggestAsync(
        IReadOnlyList<string> spanish,
        IReadOnlyList<string> english,
        IReadOnlyList<Tag> tags,
        CancellationToken cancellationToken)
    {
        Spanish = spanish;
        English = english;
        Tags = tags;
        return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<string>>(Failure);
    }

    public Task<IReadOnlyList<string>> SuggestNewAsync(
        IReadOnlyList<Tag> tags,
        IReadOnlyList<FlashCard> untagged,
        IReadOnlyList<string> exclude,
        int count,
        CancellationToken cancellationToken)
    {
        NewCallCount++;
        Tags = tags;
        Untagged = untagged;
        Exclude = exclude;
        Count = count;
        return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<string>>(Failure);
    }
}
