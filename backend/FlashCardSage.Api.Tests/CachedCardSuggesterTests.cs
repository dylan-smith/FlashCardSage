using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class CachedCardSuggesterTests
{
    private static readonly CardSuggestion Fish = new("el pez", "the fish");

    private static readonly CardSuggestion Mouse = new("el ratón", "the mouse");

    [Fact]
    public async Task SuggestAsync_AsksAndKeepsARequestItHasntSeen()
    {
        await using var dbContext = TestDb.Create();
        var cards = new List<FlashCard> { TestDb.Card("el gato", "the cat") };
        var suggester = new FakeCardSuggester { Result = [Fish] };

        var result = await Suggest(suggester, dbContext, cards);

        Assert.Equal([Fish], result);
        Assert.Equal(1, suggester.CallCount);
        var cached = Assert.Single(dbContext.CardSuggestions);
        Assert.Equal(CachedCardSuggester.PromptHash(cards, null, null, 8), cached.PromptHash);
        Assert.Equal([Fish], cached.Suggestions);
        Assert.Equal(TestDb.UserId, cached.UserId);
        Assert.NotEqual(default, cached.CreatedAt);
    }

    [Fact]
    public async Task SuggestAsync_AnswersARequestItHasSeen_WithoutAsking()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cards = new List<FlashCard> { TestDb.Card("el gato", "the cat") };
        await using (var dbContext = TestDb.Create(databaseName))
        {
            await Suggest(new FakeCardSuggester { Result = [Fish, Mouse] }, dbContext, cards);
        }
        await using var secondContext = TestDb.Create(databaseName);
        var suggester = new FakeCardSuggester { Failure = new HttpRequestException("shouldn't be called") };

        var result = await Suggest(suggester, secondContext, cards);

        Assert.Equal([Fish, Mouse], result);
        Assert.Equal(0, suggester.CallCount);
    }

    [Fact]
    public async Task SuggestAsync_AsksAgain_WhenTheRequestChanges()
    {
        await using var dbContext = TestDb.Create();
        var cat = TestDb.Card("el gato", "the cat", tags: ["animals"]);
        var suggester = new FakeCardSuggester { Result = [Fish] };
        var cachedSuggester = CreateCachedSuggester(suggester, dbContext);
        await cachedSuggester.SuggestAsync([cat], null, null, [], 8, CancellationToken.None);

        // Another card, a card's changed tags, the card they're related to, a tag and another count.
        await cachedSuggester.SuggestAsync(
            [cat, TestDb.Card("el perro", "the dog")], null, null, [], 8, CancellationToken.None);
        await cachedSuggester.SuggestAsync(
            [TestDb.Card("el gato", "the cat", tags: ["pets"])], null, null, [], 8, CancellationToken.None);
        await cachedSuggester.SuggestAsync([cat], cat, null, [], 8, CancellationToken.None);
        await cachedSuggester.SuggestAsync([cat], null, new Tag { Name = "animals" }, [], 8, CancellationToken.None);
        await cachedSuggester.SuggestAsync([cat], null, null, [], 9, CancellationToken.None);

        Assert.Equal(6, suggester.CallCount);
        Assert.Equal(6, await dbContext.CardSuggestions.CountAsync());
    }

    [Fact]
    public async Task SuggestAsync_AsksAgainAndReplacesTheKeptSuggestions_WhenAskedForMore()
    {
        await using var dbContext = TestDb.Create();
        var cards = new List<FlashCard> { TestDb.Card("el gato", "the cat") };
        var suggester = new FakeCardSuggester { Result = [Fish] };
        await Suggest(suggester, dbContext, cards);
        suggester.Result = [Mouse];

        var result = await Suggest(suggester, dbContext, cards, exclude: ["el pez"]);

        Assert.Equal([Mouse], result);
        Assert.Equal(2, suggester.CallCount);
        Assert.Equal(["el pez"], suggester.Exclude);
        // Kept for the request with nothing excluded, which is what opening the page asks.
        var cached = Assert.Single(dbContext.CardSuggestions);
        Assert.Equal(CachedCardSuggester.PromptHash(cards, null, null, 8), cached.PromptHash);
        Assert.Equal([Mouse], cached.Suggestions);
        Assert.Equal([Mouse], await Suggest(suggester, dbContext, cards));
        Assert.Equal(2, suggester.CallCount);
    }

    [Fact]
    public async Task SuggestAsync_KeepsEachUsersSuggestionsApart()
    {
        var databaseName = TestDb.NewDatabaseName();
        var cards = new List<FlashCard> { TestDb.Card("el gato", "the cat") };
        await using (var dbContext = TestDb.Create(databaseName, TestDb.UserId))
        {
            await Suggest(new FakeCardSuggester { Result = [Fish] }, dbContext, cards);
        }
        await using var otherUsersContext = TestDb.Create(databaseName, TestDb.OtherUserId);
        var suggester = new FakeCardSuggester { Result = [Mouse] };

        var result = await Suggest(suggester, otherUsersContext, cards);

        Assert.Equal([Mouse], result);
        Assert.Equal(1, suggester.CallCount);
    }

    [Fact]
    public async Task SuggestAsync_KeepsNothing_WhenSuggestingFails()
    {
        await using var dbContext = TestDb.Create();
        var suggester = new FakeCardSuggester { Failure = new HttpRequestException("boom") };

        await Assert.ThrowsAsync<HttpRequestException>(() => Suggest(suggester, dbContext, []));

        Assert.Empty(dbContext.CardSuggestions);
    }

    [Fact]
    public async Task SuggestAsync_KeepsNothing_WhenNothingIsSuggested()
    {
        await using var dbContext = TestDb.Create();
        var suggester = new FakeCardSuggester();
        await Suggest(suggester, dbContext, []);

        await Suggest(suggester, dbContext, []);

        Assert.Equal(2, suggester.CallCount);
        Assert.Empty(dbContext.CardSuggestions);
    }

    [Fact]
    public async Task SuggestAsync_StillAnswers_WhenAnotherRequestKeptTheSuggestionsFirst()
    {
        await using var dbContext = TestDb.Create(interceptors: FailingSaveInterceptor.DuplicateKey("CardSuggestions"));
        var suggester = new FakeCardSuggester { Result = [Fish] };

        var result = await Suggest(suggester, dbContext, []);

        Assert.Equal([Fish], result);
    }

    [Fact]
    public async Task SuggestAsync_KeepsOnlyTheMostRecentRequests()
    {
        await using var dbContext = TestDb.Create();
        var suggester = new FakeCardSuggester { Result = [Fish] };
        var cachedSuggester = CreateCachedSuggester(suggester, dbContext);
        for (var count = 1; count <= SuggestionCache.MaxKept + 2; count++)
        {
            await cachedSuggester.SuggestAsync([], null, null, [], count, CancellationToken.None);
        }

        // The two oldest were removed, so asking for the first again asks the model.
        Assert.Equal(SuggestionCache.MaxKept, await dbContext.CardSuggestions.CountAsync());
        await cachedSuggester.SuggestAsync([], null, null, [], 1, CancellationToken.None);
        Assert.Equal(SuggestionCache.MaxKept + 3, suggester.CallCount);
    }

    [Fact]
    public void PromptHash_IsTheSha256OfTheInstructionsAndTheRequest()
    {
        var cards = new List<FlashCard> { TestDb.Card("el gato", "the cat") };
        var prompt = FoundryCardSuggester.Instructions + "\n" + FoundryCardSuggester.Request(cards, null, null, [], 8);

        Assert.Equal(
            Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(prompt))),
            CachedCardSuggester.PromptHash(cards, null, null, 8));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task IsAvailable_IsTheSuggesters(bool available)
    {
        await using var dbContext = TestDb.Create();

        Assert.Equal(available, CreateCachedSuggester(new FakeCardSuggester { IsAvailable = available }, dbContext).IsAvailable);
    }

    private static Task<IReadOnlyList<CardSuggestion>> Suggest(
        FakeCardSuggester suggester, FlashCardDbContext dbContext, List<FlashCard> cards, List<string>? exclude = null)
    {
        return CreateCachedSuggester(suggester, dbContext)
            .SuggestAsync(cards, null, null, exclude ?? [], 8, CancellationToken.None);
    }

    private static CachedCardSuggester CreateCachedSuggester(ICardSuggester suggester, FlashCardDbContext dbContext)
    {
        return new CachedCardSuggester(suggester, dbContext, NullLogger<CachedCardSuggester>.Instance);
    }
}
