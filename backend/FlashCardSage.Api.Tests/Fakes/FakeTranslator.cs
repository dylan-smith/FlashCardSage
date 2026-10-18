using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;

namespace FlashCardSage.Api.Tests.Fakes;

// Answers every translation with the result, or fails it with the failure, and keeps what it was asked.
internal sealed class FakeTranslator : ITranslator
{
    public bool IsAvailable { get; init; } = true;

    public TranslationResult Result { get; init; } = new(string.Empty, []);

    public Exception? Failure { get; init; }

    public List<(string Text, Language From)> Calls { get; } = [];

    public Task<TranslationResult> TranslateAsync(string text, Language from, CancellationToken cancellationToken)
    {
        Calls.Add((text, from));
        return Failure is null ? Task.FromResult(Result) : Task.FromException<TranslationResult>(Failure);
    }
}
