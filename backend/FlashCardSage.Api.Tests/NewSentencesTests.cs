using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;

namespace FlashCardSage.Api.Tests;

public class NewSentencesTests
{
    private static readonly int[] Scope = [1, 2, 3];

    [Fact]
    public void From_TrimsBothSides()
    {
        var sentence = Assert.Single(NewSentences.From([new("  El gato come. ", " The cat eats.  ", [1])], Scope));

        Assert.Equal("El gato come.", sentence.Spanish);
        Assert.Equal("The cat eats.", sentence.English);
        Assert.Equal([1], sentence.CardIds);
    }

    [Fact]
    public void From_LeavesOutSentencesWithABlankOrTooLongSide()
    {
        var tooLong = new string('a', SentencePracticeResult.MaxSentenceLength + 1);
        var longest = new string('b', SentencePracticeResult.MaxSentenceLength);
        PracticeSentence[] generated =
        [
            new(" ", "The cat eats.", [1]),
            new("El gato come.", "", [1]),
            new(null!, "The cat eats.", [1]),
            new(tooLong, "The cat eats.", [1]),
            new("El gato come.", tooLong, [1]),
            new(longest, longest, [1])
        ];

        var sentence = Assert.Single(NewSentences.From(generated, Scope));

        Assert.Equal(longest, sentence.Spanish);
    }

    [Fact]
    public void From_CutsTheCardIdsToTheScope_EachOnce()
    {
        var sentence = Assert.Single(NewSentences.From([new("El gato come.", "The cat eats.", [3, 9, 1, 3])], Scope));

        Assert.Equal([3, 1], sentence.CardIds);
    }

    [Fact]
    public void From_KeepsNoMoreCardIdsThanAResultKeeps()
    {
        var scope = Enumerable.Range(1, SentencePracticeResult.MaxCards + 5).ToList();

        var sentence = Assert.Single(NewSentences.From([new("El gato come.", "The cat eats.", scope)], scope));

        Assert.Equal(SentencePracticeResult.MaxCards, sentence.CardIds.Count);
    }

    [Fact]
    public void From_LeavesOutSentencesWithNoCardsInScope()
    {
        PracticeSentence[] generated =
        [
            new("El perro come.", "The dog eats.", [7, 8]),
            new("El gato bebe.", "The cat drinks.", []),
            new("El gato duerme.", "The cat sleeps.", null!)
        ];

        Assert.Empty(NewSentences.From(generated, Scope));
    }

    [Fact]
    public void From_LeavesOutRepeatedSpanish_IgnoringCase()
    {
        PracticeSentence[] generated =
        [
            new("El gato come.", "The cat eats.", [1]),
            new("el gato come.", "The cat is eating.", [2]),
            new("El gato bebe.", "The cat drinks.", [1])
        ];

        var sentences = NewSentences.From(generated, Scope).ToList();

        Assert.Equal(["El gato come.", "El gato bebe."], sentences.Select(sentence => sentence.Spanish));
        Assert.Equal("The cat eats.", sentences[0].English);
    }
}
