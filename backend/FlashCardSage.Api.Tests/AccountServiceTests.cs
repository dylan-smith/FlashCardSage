using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// What deleting an account removes, which MeControllerTests covers as responses.
public class AccountServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 19, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task DeleteAsync_DeletesEverythingOfTheUsers_AndLeavesOtherUsersAlone()
    {
        var databaseName = TestDb.NewDatabaseName();
        await SeedAccountAsync(databaseName, TestDb.UserId, "gato");
        await SeedAccountAsync(databaseName, TestDb.OtherUserId, "perro");
        await using var dbContext = TestDb.Create(databaseName);

        await CreateService(dbContext, new FakeImageStore()).DeleteAsync();

        await using var after = TestDb.Create(databaseName);
        Assert.Equal([TestDb.OtherUserId], await after.Users.Select(user => user.Id).ToListAsync());
        Assert.Equal([TestDb.OtherUserId], await OwnersAsync(after.FlashCards));
        Assert.Equal([TestDb.OtherUserId, TestDb.OtherUserId], await OwnersAsync(after.FlashCardWords));
        Assert.Equal([TestDb.OtherUserId, TestDb.OtherUserId], await OwnersAsync(after.Tags));
        Assert.Equal([TestDb.OtherUserId], await OwnersAsync(after.Decks));
        Assert.Equal([TestDb.OtherUserId], await OwnersAsync(after.SentencePracticeResults));
        Assert.Equal([TestDb.OtherUserId], await OwnersAsync(after.TagSuggestions));
        Assert.Equal([TestDb.OtherUserId], await OwnersAsync(after.OAuthGrants));
        Assert.Equal(
            [TestDb.OtherUserId],
            await after.PracticeResults.IgnoreQueryFilters().Select(result => result.FlashCard.UserId).ToListAsync());
        Assert.Equal(
            [TestDb.OtherUserId],
            await after.OAuthAuthorizationRequests.Select(request => request.UserId!.Value).ToListAsync());
        var othersGrantId = await after.OAuthGrants.IgnoreQueryFilters().Select(grant => grant.Id).SingleAsync();
        Assert.Equal([othersGrantId], await after.OAuthTokens.Select(token => token.GrantId).ToListAsync());
        // The apps aren't anyone's, so both are still registered.
        Assert.Equal(2, await after.OAuthClients.CountAsync());
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheUsersPictures_ExceptCachedOnes()
    {
        var databaseName = TestDb.NewDatabaseName();
        var uploaded = FakeImageStore.BaseUrl + "uploaded.jpg";
        var generated = FakeImageStore.BaseUrl + "generated.jpg";
        await using (var seed = TestDb.Create(databaseName))
        {
            seed.Users.Add(new User { Id = TestDb.UserId, Subject = "test:alice", CreatedAt = Now });
            seed.FlashCards.AddRange(
                TestDb.Card("el gato", "the cat", imageUrl: uploaded),
                TestDb.Card("el perro", "the dog", imageUrl: generated),
                TestDb.Card("la casa", "the house"));
            seed.GeneratedImages.Add(
                new CachedImage { PromptHash = new string('a', CachedImage.PromptHashLength), ImageUrl = generated, CreatedAt = Now });
            await seed.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var imageStore = new FakeImageStore();

        await CreateService(dbContext, imageStore).DeleteAsync();

        Assert.Equal([uploaded], imageStore.Deleted);
        Assert.Equal(generated, (await dbContext.GeneratedImages.SingleAsync()).ImageUrl);
    }

    private static AccountService CreateService(FlashCardDbContext dbContext, FakeImageStore imageStore)
    {
        return new AccountService(
            dbContext, new Authentication.CurrentUser { UserId = TestDb.UserId }, imageStore, NullLogger<AccountService>.Instance);
    }

    // The owners of every row, whoever's they are.
    private static Task<List<int>> OwnersAsync<T>(DbSet<T> rows)
        where T : class
    {
        return rows.IgnoreQueryFilters().Select(row => EF.Property<int>(row, nameof(IUserOwned.UserId))).ToListAsync();
    }

    // A user with one of everything a user can own: a card with a tag, in a deck, with a practice result, a sentence
    // practice result, cached tag suggestions, a connected app with a token and a sign-in to an app in progress.
    private static async Task SeedAccountAsync(string databaseName, int userId, string word)
    {
        await using var dbContext = TestDb.Create(databaseName, userId);
        dbContext.Users.Add(new User { Id = userId, Subject = $"test:{word}", CreatedAt = Now });
        var card = TestDb.Card(word, $"the {word}", tags: [$"{word} tag"]);
        dbContext.FlashCards.Add(card);
        dbContext.Decks.Add(new Deck { Name = $"{word} deck", FlashCards = [card] });
        dbContext.Tags.Add(new Tag { Name = $"{word} unused tag" });
        dbContext.PracticeResults.Add(
            new PracticeResult { FlashCard = card, Outcome = PracticeOutcome.GotIt, PracticedAt = Now });
        dbContext.SentencePracticeResults.Add(new SentencePracticeResult
        {
            Spanish = word,
            English = $"the {word}",
            ShownSide = Language.Spanish,
            Outcome = PracticeOutcome.GotIt,
            PracticedAt = Now
        });
        dbContext.TagSuggestions.Add(new CachedTagSuggestions
        {
            PromptHash = new string('a', 64),
            Suggestions = ["animals"],
            CreatedAt = Now
        });
        var client = new OAuthClient { ClientId = $"{word}-app", RedirectUris = ["https://app.test/callback"], CreatedAt = Now, UpdatedAt = Now };
        var grant = new OAuthGrant { Client = client, Scope = "mcp", CreatedAt = Now };
        dbContext.OAuthGrants.Add(grant);
        dbContext.OAuthAuthorizationRequests.Add(new OAuthAuthorizationRequest
        {
            Id = Guid.NewGuid(),
            Client = client,
            UserId = userId,
            RedirectUri = "https://app.test/callback",
            Scope = "mcp",
            CodeChallenge = "challenge"
        });
        await dbContext.SaveChangesAsync();

        dbContext.OAuthTokens.Add(new OAuthToken
        {
            GrantId = grant.Id,
            FamilyId = Guid.NewGuid(),
            Kind = OAuthTokenKind.Access,
            TokenHash = new string(word[0], 64),
            CreatedAt = Now,
            ExpiresAt = Now.AddHours(1)
        });
        await dbContext.SaveChangesAsync();
    }
}
