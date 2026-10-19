using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The cache itself is shared with the cards' suggestions, and tested in CachedCardSuggesterTests.
public class CachedTagSuggesterTests
{
    [Fact]
    public async Task SuggestNewAsync_AsksAndKeepsARequestItHasntSeen()
    {
        await using var dbContext = TestDb.Create();
        var tags = new List<Tag> { new() { Name = "Animals" } };
        var suggester = new FakeTagSuggester { Result = ["Food", "Colors"] };

        var result = await SuggestNew(suggester, dbContext, tags, []);

        Assert.Equal(["Food", "Colors"], result);
        var cached = Assert.Single(dbContext.TagSuggestions);
        Assert.Equal(CachedTagSuggester.PromptHash(tags, [], 8), cached.PromptHash);
        Assert.Equal(["Food", "Colors"], cached.Suggestions);
        Assert.Equal(TestDb.UserId, cached.UserId);
    }

    [Fact]
    public async Task SuggestNewAsync_AnswersARequestItHasSeen_WithoutAsking()
    {
        var databaseName = TestDb.NewDatabaseName();
        var untagged = new List<FlashCard> { TestDb.Card("rojo", "red") };
        await using (var dbContext = TestDb.Create(databaseName))
        {
            await SuggestNew(new FakeTagSuggester { Result = ["Colors"] }, dbContext, [], untagged);
        }
        await using var secondContext = TestDb.Create(databaseName);
        var suggester = new FakeTagSuggester { Failure = new HttpRequestException("shouldn't be called") };

        var result = await SuggestNew(suggester, secondContext, [], untagged);

        Assert.Equal(["Colors"], result);
        Assert.Equal(0, suggester.NewCallCount);
    }

    [Fact]
    public async Task SuggestNewAsync_AsksAgain_WhenTheRequestChanges()
    {
        await using var dbContext = TestDb.Create();
        var suggester = new FakeTagSuggester { Result = ["Colors"] };
        var animals = new Tag { Name = "Animals" };
        await SuggestNew(suggester, dbContext, [animals], []);

        // Another tag, a tag's cards and an untagged card.
        await SuggestNew(suggester, dbContext, [animals, new Tag { Name = "Food" }], []);
        await SuggestNew(
            suggester, dbContext, [new Tag { Name = "Animals", FlashCards = [TestDb.Card("el gato", "the cat")] }], []);
        await SuggestNew(suggester, dbContext, [animals], [TestDb.Card("rojo", "red")]);

        Assert.Equal(4, suggester.NewCallCount);
        Assert.Equal(4, await dbContext.TagSuggestions.CountAsync());
    }

    [Fact]
    public async Task SuggestNewAsync_KeepsEachUsersSuggestionsApart()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var dbContext = TestDb.Create(databaseName, TestDb.UserId))
        {
            await SuggestNew(new FakeTagSuggester { Result = ["Food"] }, dbContext, [], []);
        }
        await using var otherUsersContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        var suggester = new FakeTagSuggester { Result = ["Colors"] };

        var result = await SuggestNew(suggester, otherUsersContext, [], []);

        Assert.Equal(["Colors"], result);
        Assert.Equal(1, suggester.NewCallCount);
    }

    [Fact]
    public async Task SuggestNewAsync_AsksAgainAndReplacesTheKeptSuggestions_WhenAskedForMore()
    {
        await using var dbContext = TestDb.Create();
        var suggester = new FakeTagSuggester { Result = ["Food"] };
        await SuggestNew(suggester, dbContext, [], []);
        suggester.Result = ["Colors"];

        var result = await SuggestNew(suggester, dbContext, [], [], exclude: ["Food"]);

        Assert.Equal(["Colors"], result);
        Assert.Equal(["Food"], suggester.Exclude);
        Assert.Equal(["Colors"], Assert.Single(dbContext.TagSuggestions).Suggestions);
        Assert.Equal(["Colors"], await SuggestNew(suggester, dbContext, [], []));
        Assert.Equal(2, suggester.NewCallCount);
    }

    [Fact]
    public void PromptHash_IsTheHashOfTheNewTagInstructionsAndRequest()
    {
        var tags = new List<Tag> { new() { Name = "Animals" } };

        Assert.Equal(
            SuggestionCache.PromptHash(
                FoundryTagSuggester.NewTagInstructions, FoundryTagSuggester.NewTagsRequest(tags, [], [], 8)),
            CachedTagSuggester.PromptHash(tags, [], 8));
    }

    private static Task<IReadOnlyList<string>> SuggestNew(
        FakeTagSuggester suggester,
        FlashCardDbContext dbContext,
        List<Tag> tags,
        List<FlashCard> untagged,
        List<string>? exclude = null)
    {
        return new CachedTagSuggester(suggester, dbContext, NullLogger<CachedTagSuggester>.Instance)
            .SuggestNewAsync(tags, untagged, exclude ?? [], 8, CancellationToken.None);
    }
}
