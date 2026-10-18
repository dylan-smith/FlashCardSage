using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions.Foundry;

namespace FlashCardSage.Api.Tests;

public class PromptTextTests
{
    [Fact]
    public void Card_IsSpanishEqualsEnglish_WithEachSidesWordsSeparatedBySlashes()
    {
        var card = new FlashCard { Words = TestDb.Words(["solo", "únicamente"], ["only"]) };

        Assert.Equal("solo / únicamente = only", PromptText.Card(card));
        Assert.Equal("el gato = the cat / the kitty", PromptText.Card(["el gato"], ["the cat", "the kitty"]));
    }

    [Fact]
    public void CardWithTags_AddsTheTagsInBrackets_WhenThereAreAny()
    {
        var tagged = new FlashCard
        {
            Words = TestDb.Words("el gato", "the cat"),
            Tags = [new Tag { Name = "animals" }, new Tag { Name = "home" }]
        };
        var untagged = TestDb.Card("comer", "to eat");

        Assert.Equal("el gato = the cat [animals, home]", PromptText.CardWithTags(tagged));
        Assert.Equal("comer = to eat", PromptText.CardWithTags(untagged));
    }
}
