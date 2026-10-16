using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Tests;

public class TakenWordsTests
{
    [Fact]
    public async Task LoadAsync_TakesTheUsersWordsIgnoringCase_ButNotAnotherUsers()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardAsync(databaseName, new FlashCard { Words = TestDb.Words(["el gato", "el gatito"], ["the cat"]) });
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"), TestDb.OtherUserId);
        await using var dbContext = TestDb.Create(databaseName);

        var taken = await TakenWords.LoadAsync(dbContext, exceptCardId: null, CancellationToken.None);

        Assert.True(taken.Contains(Language.Spanish, "EL GATITO"));
        Assert.True(taken.Contains(Language.English, "The Cat"));
        Assert.False(taken.Contains(Language.English, "el gato"));
        Assert.False(taken.Contains(Language.Spanish, "el perro"));
    }

    [Fact]
    public async Task LoadAsync_LeavesOutTheCardBeingChanged()
    {
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName);

        var taken = await TakenWords.LoadAsync(dbContext, exceptCardId: catId, CancellationToken.None);

        Assert.False(taken.Contains(Language.Spanish, "el gato"));
        Assert.True(taken.Contains(Language.Spanish, "el perro"));
    }

    [Fact]
    public async Task FirstClash_IsTheSavedWord_SpanishFirstThenEnglishInOrder()
    {
        var databaseName = TestDb.NewDatabaseName();
        var catId = await TestDb.SeedCardAsync(databaseName, TestDb.Card("el gato", "the cat"));
        await TestDb.SeedCardAsync(databaseName, TestDb.Card("el perro", "the dog"));
        await using var dbContext = TestDb.Create(databaseName);
        var taken = await TakenWords.LoadAsync(dbContext, exceptCardId: null, CancellationToken.None);

        var spanish = taken.FirstClash(["la casa", "El Gato"], ["the dog"]);
        var english = taken.FirstClash(["la casa"], ["the house", "THE CAT", "the dog"]);

        Assert.Equal((Language.Spanish, "el gato", catId), (spanish?.Language, spanish?.Text, spanish?.FlashCardId));
        Assert.Equal((Language.English, "the cat"), (english?.Language, english?.Text));
        Assert.Null(taken.FirstClash(["la casa"], ["the house"]));
    }

    [Fact]
    public void From_TakesTheCardsWords_AndAddTakesMore()
    {
        var taken = TakenWords.From([TestDb.Card("el gato", "the cat")]);

        taken.Add(TestDb.Card("el perro", "the dog"));
        taken.Add(Language.English, "the house");

        Assert.True(taken.Contains(Language.Spanish, "El Perro"));
        Assert.True(taken.Contains(Language.English, "the house"));
        Assert.False(taken.Contains(Language.Spanish, "the house"));
        Assert.True(taken.ContainsAny(TestDb.Card("la casa", "THE CAT")));
        Assert.False(taken.ContainsAny(TestDb.Card("la casa", "the home")));
    }
}
