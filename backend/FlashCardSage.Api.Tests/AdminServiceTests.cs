using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Contracts.Admin;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Tests.Fakes;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Tests;

public sealed class AdminServiceTests : IDisposable
{
    private const int AliceId = 1;
    private const int BobId = 2;
    private const int CarolId = 3;
    private const int SystemUserId = 4;
    private const int ServiceUserId = 5;

    private readonly FixedTimeProvider clock = new();

    // The service's own context, which the test disposes.
    private FlashCardDbContext? serviceDbContext;

    private DateTimeOffset Now => clock.Now;

    public void Dispose()
    {
        serviceDbContext?.Dispose();
    }

    [Fact]
    public async Task Overview_CountsOnlyPeople()
    {
        var service = await CreateServiceAsync();

        var overview = await service.GetOverviewAsync();

        Assert.Equal(3, overview.Users);
        Assert.Equal(1, overview.ActiveUsersLast7Days);
        Assert.Equal(2, overview.ActiveUsersLast30Days);
        Assert.Equal(2, overview.NewUsersLast30Days);
        Assert.Equal(3, overview.Cards);
        Assert.Equal(1, overview.Decks);
        Assert.Equal(1, overview.Tags);
        Assert.Equal(3, overview.PracticeResults);
        Assert.Equal(1, overview.PracticeResultsLast7Days);
        Assert.Equal(2, overview.PracticeResultsLast30Days);
        Assert.Equal(1, overview.OAuthClients);
        Assert.Equal(1, overview.ConnectedApps);
        Assert.Equal(0, overview.CachedTranslations);
        Assert.Equal(0, overview.GeneratedImages);
    }

    [Fact]
    public async Task Overview_CountsCardsBySource_WithUnknownForUnrecordedOnes()
    {
        var service = await CreateServiceAsync();

        var overview = await service.GetOverviewAsync();

        // The system and service users' cards (unknown and Mcp) aren't counted.
        Assert.Equal(
            new Dictionary<string, int>
            {
                ["Manual"] = 1,
                ["Suggested"] = 0,
                ["Document"] = 1,
                ["Preply"] = 0,
                ["Duolingo"] = 0,
                ["SystemDeck"] = 0,
                ["Mcp"] = 0,
                ["Shared"] = 0,
                [AdminService.UnknownSource] = 1
            },
            overview.CardsBySource);
    }

    [Fact]
    public async Task ListUsers_CountsEachPersonsData_LastSeenFirst()
    {
        var service = await CreateServiceAsync();

        var users = await service.ListUsersAsync();

        // Alice's practiced card scores 50 for its last Got it!, and her other card nothing.
        Assert.Equal(
            [
                new AdminUserSummary(
                    AliceId, "test:alice", "test", "Alice", "alice@example.com", Now.AddDays(-60), Now.AddDays(-1),
                    Cards: 2, Decks: 1, Tags: 1, PracticeResults: 3, Now.AddDays(-2), ConnectedApps: 1,
                    Score: 50, MaximumScore: 200),
                new AdminUserSummary(
                    BobId, "google:123", "google", "Bob", null, Now.AddDays(-5), Now.AddDays(-20),
                    Cards: 1, Decks: 0, Tags: 0, PracticeResults: 0, null, ConnectedApps: 0,
                    Score: 0, MaximumScore: 100),
                new AdminUserSummary(
                    CarolId, "test:carol", "test", "Carol", null, Now.AddDays(-1), null,
                    Cards: 0, Decks: 0, Tags: 0, PracticeResults: 0, null, ConnectedApps: 0,
                    Score: 0, MaximumScore: 0)
            ],
            users);
    }

    [Fact]
    public async Task ListUsersAndGetUser_TotalEachPersonsCardScores_FromTheirLastRunOfGotIt()
    {
        var service = await CreateServiceAsync();
        var bobsCardId = serviceDbContext!.FlashCards.IgnoreQueryFilters().Single(card => card.UserId == BobId).Id;
        // Oldest first: a miss, then more Got it! in a row than it takes to score the most.
        serviceDbContext.PracticeResults.AddRange(
            new[] { PracticeOutcome.Failed }
                .Concat(Enumerable.Repeat(PracticeOutcome.GotIt, PracticeScore.MaximumStreak + 1))
                .Select(outcome => new PracticeResult { FlashCardId = bobsCardId, Outcome = outcome, PracticedAt = Now }));
        await serviceDbContext.SaveChangesAsync();

        var users = await service.ListUsersAsync();

        Assert.Equal(
            [(AliceId, 50, 200), (BobId, 100, 100), (CarolId, 0, 0)],
            users.Select(user => (user.Id, user.Score, user.MaximumScore)));
        var bob = (await service.GetUserAsync(BobId))!.User;
        Assert.Equal((100, 100), (bob.Score, bob.MaximumScore));
    }

    [Fact]
    public async Task GetUser_DescribesThePerson()
    {
        var service = await CreateServiceAsync();

        var user = await service.GetUserAsync(AliceId);

        Assert.NotNull(user);
        Assert.Equal(AliceId, user.User.Id);
        Assert.Equal(new PreferencesResponse(ShowPictures: false, ShowSuggestions: true, AutoTranslate: true), user.Preferences);
        var deck = Assert.Single(user.Decks);
        Assert.Equal(("Week 1", 2), (deck.Name, deck.CardCount));
        Assert.NotNull(deck.CreatedAt);
        var tag = Assert.Single(user.Tags);
        Assert.Equal(("Animals", 1), (tag.Name, tag.CardCount));
        var app = Assert.Single(user.ConnectedApps);
        Assert.Equal(("Claude", "claude.ai", false), (app.ClientName, app.ClientHost, app.ClientNameIsSelfAsserted));
        Assert.Equal(1, user.CardsBySource["Manual"]);
        Assert.Equal(1, user.CardsBySource["Document"]);
        Assert.Equal(0, user.CardsBySource[AdminService.UnknownSource]);
    }

    [Fact]
    public async Task GetUser_SummarizesPractice_ByDayAndNewestFirst()
    {
        var service = await CreateServiceAsync();

        var practice = (await service.GetUserAsync(AliceId))!.Practice;

        Assert.Equal((2, 0, 1), (practice.GotIt, practice.WasClose, practice.Failed));
        Assert.Equal((Now.AddDays(-40), Now.AddDays(-2)), (practice.FirstPracticedAt, practice.LastPracticedAt));
        var today = DateOnly.FromDateTime(Now.UtcDateTime);
        Assert.Equal(AdminService.PracticeDays, practice.ByDay.Count);
        Assert.Equal((today.AddDays(1 - AdminService.PracticeDays), today), (practice.ByDay[0].Date, practice.ByDay[^1].Date));
        Assert.Equal(
            [new AdminPracticeDay(today.AddDays(-10), 1), new AdminPracticeDay(today.AddDays(-2), 1)],
            practice.ByDay.Where(day => day.Results > 0));
        Assert.Equal(
            [PracticeOutcome.GotIt, PracticeOutcome.Failed, PracticeOutcome.GotIt],
            practice.Recent.Select(result => result.Outcome));
        Assert.Equal(["el gato"], practice.Recent[0].Spanish);
    }

    [Fact]
    public async Task GetUser_HasNoPractice_ForSomeoneWhoHasntPracticed()
    {
        var service = await CreateServiceAsync();

        var practice = (await service.GetUserAsync(BobId))!.Practice;

        Assert.Equal((0, 0, 0), (practice.GotIt, practice.WasClose, practice.Failed));
        Assert.Null(practice.FirstPracticedAt);
        Assert.Null(practice.LastPracticedAt);
        Assert.All(practice.ByDay, day => Assert.Equal(0, day.Results));
        Assert.Empty(practice.Recent);
    }

    [Fact]
    public async Task ListUserCards_ListsThePersonsCards_WithSourcesAndScores()
    {
        var service = await CreateServiceAsync();

        var cards = await service.ListUserCardsAsync(AliceId);

        Assert.NotNull(cards);
        Assert.Equal(2, cards.Count);
        var gato = cards[0];
        Assert.Equal(["el gato"], gato.Spanish);
        Assert.Equal(["the cat"], gato.English);
        Assert.Equal(["Animals"], gato.Tags);
        Assert.Equal(["Week 1"], gato.Decks);
        Assert.Equal("Manual", gato.Source);
        Assert.Equal((50, 2, 0, 1), (gato.Score, gato.GotIt, gato.WasClose, gato.Failed));
        Assert.Equal(Now.AddDays(-2), gato.LastPracticedAt);
        Assert.NotNull(gato.CreatedAt);
        Assert.Equal("Document", cards[1].Source);
        Assert.Null(cards[1].LastPracticedAt);

        var bobsCard = Assert.Single((await service.ListUserCardsAsync(BobId))!);
        Assert.Equal(AdminService.UnknownSource, bobsCard.Source);
    }

    [Theory]
    [InlineData(99)]
    [InlineData(SystemUserId)]
    [InlineData(ServiceUserId)]
    public async Task GetUserAndListUserCards_ReturnNull_ForAnyoneButAPerson(int id)
    {
        var service = await CreateServiceAsync();

        Assert.Null(await service.GetUserAsync(id));
        Assert.Null(await service.ListUserCardsAsync(id));
    }

    // Alice has two cards in a deck, one tagged and practiced three times, and a connected app; Bob has a card whose
    // source wasn't recorded; Carol has nothing. The system and service users have cards, a deck and a tag of their
    // own, which mustn't be counted.
    private async Task<AdminService> CreateServiceAsync()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using (var dbContext = TestDb.Create(databaseName))
        {
            dbContext.Users.AddRange(
                new User
                {
                    Id = AliceId,
                    Subject = "test:alice",
                    DisplayName = "Alice",
                    Email = "alice@example.com",
                    CreatedAt = Now.AddDays(-60),
                    LastSeenAt = Now.AddDays(-1),
                    ShowPictures = false
                },
                new User
                {
                    Id = BobId,
                    Subject = "google:123",
                    DisplayName = "Bob",
                    CreatedAt = Now.AddDays(-5),
                    LastSeenAt = Now.AddDays(-20)
                },
                new User { Id = CarolId, Subject = "test:carol", DisplayName = "Carol", CreatedAt = Now.AddDays(-1) },
                new User { Id = SystemUserId, Subject = User.SystemSubject, CreatedAt = Now.AddDays(-90) },
                new User { Id = ServiceUserId, Subject = LocalTokenHandler.ServiceSubject, CreatedAt = Now.AddDays(-90) });
            await dbContext.SaveChangesAsync();
        }

        await using (var dbContext = TestDb.Create(databaseName, AliceId))
        {
            var gato = new FlashCard
            {
                Words = TestDb.Words("el gato", "the cat"),
                Tags = [new Tag { Name = "Animals" }],
                Source = CardSource.Manual
            };
            var perro = new FlashCard { Words = TestDb.Words("el perro", "the dog"), Source = CardSource.Document };
            dbContext.Decks.Add(new Deck { Name = "Week 1", FlashCards = [gato, perro] });
            var client = new OAuthClient
            {
                ClientId = "https://claude.ai/oauth/mcp-oauth-client-metadata",
                Name = "Claude",
                IsMetadataDocument = true,
                CreatedAt = Now,
                UpdatedAt = Now
            };
            dbContext.OAuthGrants.Add(new OAuthGrant { Client = client, Scope = "mcp", CreatedAt = Now });
            await dbContext.SaveChangesAsync();

            // Added oldest first, so the newest has the highest ID, as when they're practiced.
            dbContext.PracticeResults.AddRange(
                new PracticeResult { FlashCardId = gato.Id, Outcome = PracticeOutcome.GotIt, PracticedAt = Now.AddDays(-40) },
                new PracticeResult { FlashCardId = gato.Id, Outcome = PracticeOutcome.Failed, PracticedAt = Now.AddDays(-10) },
                new PracticeResult { FlashCardId = gato.Id, Outcome = PracticeOutcome.GotIt, PracticedAt = Now.AddDays(-2) });
            await dbContext.SaveChangesAsync();
        }

        await TestDb.SeedCardAsync(databaseName, TestDb.Card("la casa", "the house"), BobId);
        await using (var dbContext = TestDb.Create(databaseName, SystemUserId))
        {
            dbContext.Decks.Add(new Deck
            {
                Name = "Food",
                FlashCards = [TestDb.Card("el pan", "the bread", tags: ["Food"])]
            });
            await dbContext.SaveChangesAsync();
        }

        await TestDb.SeedCardAsync(
            databaseName, new FlashCard { Words = TestDb.Words("el agua", "the water"), Source = CardSource.Mcp }, ServiceUserId);

        serviceDbContext = TestDb.Create(databaseName);
        return new AdminService(serviceDbContext, clock);
    }
}
