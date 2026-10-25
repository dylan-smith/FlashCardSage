using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;

namespace FlashCardSage.Api.Tests;

public class NewSentencesTests
{
    private static readonly FlashCard[] Scope = [Card(1, "gato"), Card(2, "perro"), Card(3, "comer")];

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
        var sentence = Assert.Single(NewSentences.From([new("Él come.", "He eats.", [3, 9, 1, 3])], Scope));

        Assert.Equal([3, 1], sentence.CardIds);
    }

    [Fact]
    public void From_KeepsNoMoreCardIdsThanAResultKeeps()
    {
        var scope = Enumerable.Range(1, SentencePracticeResult.MaxCards + 5).Select(id => Card(id, $"palabra{id}"))
            .ToList();

        var sentence = Assert.Single(
            NewSentences.From([new("El gato come.", "The cat eats.", [.. scope.Select(card => card.Id)])], scope));

        Assert.Equal(SentencePracticeResult.MaxCards, sentence.CardIds.Count);
    }

    [Fact]
    public void From_LeavesOutSentencesTheModelGaveNoCardsInScopeFor()
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

    [Fact]
    public void From_AddsTheCardsInScopeWhoseSpanishIsInTheSentence_AfterTheModelsOnes()
    {
        FlashCard[] scope =
        [
            Card(1, "poder"), Card(2, "cerrar"), Card(3, "la puerta"), Card(4, "por favor"), Card(5, "la ventana")
        ];

        var sentence = Assert.Single(NewSentences.From(
            [new("¿Puedes cerrar la puerta, por favor?", "Can you close the door, please?", [1])], scope));

        Assert.Equal([1, 2, 3, 4], sentence.CardIds);
    }

    [Fact]
    public void From_FindsACardByAnyOfItsWords_IgnoringCaseAndAccents()
    {
        FlashCard[] scope = [Card(1, "gato"), Card(2, "solo", "únicamente"), Card(3, "Está bien")];

        var sentence = Assert.Single(
            NewSentences.From([new("Unicamente el gato. ESTA BIEN.", "Only the cat. It's fine.", [1])], scope));

        Assert.Equal([1, 2, 3], sentence.CardIds);
    }

    [Fact]
    public void From_FindsOnlyWholeWordsTogether_LeavingOutANoteInBrackets()
    {
        FlashCard[] scope =
        [
            Card(1, "gato"), Card(2, "el"), Card(3, "puerta abierta"), Card(4, "cerrar (algo)"), Card(5, "ato")
        ];

        var sentence = Assert.Single(NewSentences.From(
            [new("Los gatos van a cerrar la puerta, no abierta.", "The cats will close the door, not open.", [1])],
            scope));

        Assert.Equal([1, 4], sentence.CardIds);
    }

    private static FlashCard Card(int id, params string[] spanish)
    {
        var card = new FlashCard { Id = id };
        card.SetWords(Language.Spanish, spanish);
        card.SetWords(Language.English, ["word"]);
        return card;
    }
}
