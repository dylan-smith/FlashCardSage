using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Usage;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class UsageTests(WebApplicationFactory<Program> factory) : IClassFixture<WebApplicationFactory<Program>>
{
    private const string ServiceToken = "service-token-for-tests";

    [Fact]
    public async Task Snapshot_CountsEachPersonsCardsDecksTagsAndPracticeResults()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using var dbContext = TestDb.Create(databaseName);
        var aliceCreatedAt = new DateTimeOffset(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);
        dbContext.Users.AddRange(
            new User { Id = TestDb.UserId, Subject = "test:alice", CreatedAt = aliceCreatedAt },
            new User { Id = TestDb.OtherUserId, Subject = "test:bob" });
        await dbContext.SaveChangesAsync();
        await AddCardsAsync(databaseName, TestDb.UserId, practiceResults: 3, "el gato", "el perro");
        await AddCardsAsync(databaseName, TestDb.OtherUserId, practiceResults: 0, "la casa");

        var usage = await UsageSnapshot.TakeAsync(dbContext, NullLogger.Instance, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal(
            [
                new UserUsage(TestDb.UserId, aliceCreatedAt, Cards: 2, Decks: 1, Tags: 1, PracticeResults: 3),
                new UserUsage(TestDb.OtherUserId, default, Cards: 1, Decks: 1, Tags: 1, PracticeResults: 0)
            ],
            usage);
    }

    [Fact]
    public async Task Snapshot_LeavesOutTheSystemAndServiceUsers()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Users.AddRange(
            new User { Id = 1, Subject = User.SystemSubject },
            new User { Id = 2, Subject = LocalTokenHandler.ServiceSubject },
            new User { Id = 3, Subject = "google:123" });
        await dbContext.SaveChangesAsync();

        var usage = await UsageSnapshot.TakeAsync(dbContext, NullLogger.Instance, DateTimeOffset.UtcNow, CancellationToken.None);

        Assert.Equal([3], usage.Select(user => user.UserId));
    }

    [Fact]
    public async Task SnapshotService_TakesASnapshotAtMostOncePerInterval()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var dbContext = TestDb.Create(databaseName))
        {
            dbContext.Users.Add(new User { Subject = "test:alice" });
            await dbContext.SaveChangesAsync();
        }

        var services = new ServiceCollection()
            .AddScoped<CurrentUser>()
            .AddDbContext<FlashCardDbContext>(options => options.UseInMemoryDatabase(databaseName))
            .BuildServiceProvider();
        var clock = new FakeTimeProvider();
        var logger = new SnapshotCountingLogger();
        var service = new UsageSnapshotService(services.GetRequiredService<IServiceScopeFactory>(), clock, logger);

        await service.TakeIfDueAsync(CancellationToken.None);
        clock.Now += UsageSnapshotService.Interval - TimeSpan.FromMinutes(1);
        await service.TakeIfDueAsync(CancellationToken.None);
        Assert.Equal(1, logger.Snapshots);

        clock.Now += TimeSpan.FromMinutes(1);
        await service.TakeIfDueAsync(CancellationToken.None);
        Assert.Equal(2, logger.Snapshots);
    }

    [Fact]
    public async Task Requests_AreTaggedWithThePersonsUserId()
    {
        var webFactory = CreateFactory();
        var name = $"Alice {Guid.NewGuid()}";
        var subject = $"test:{name.ToLowerInvariant()}";

        var request = await SendAsync(webFactory, $"test:{name}");

        using var scope = webFactory.Services.CreateScope();
        var userId = await scope.ServiceProvider.GetRequiredService<FlashCardDbContext>().Users
            .Where(user => user.Subject == subject)
            .Select(user => user.Id)
            .SingleAsync();
        Assert.Equal(userId.ToString(CultureInfo.InvariantCulture), request.GetTagItem(CurrentUserMiddleware.UserIdTag));
    }

    [Fact]
    public async Task Requests_AreNotTagged_ForTheServiceUser()
    {
        var request = await SendAsync(CreateFactory(), ServiceToken);

        Assert.Null(request.GetTagItem(CurrentUserMiddleware.UserIdTag));
    }

    // Adds cards for a user, all in one deck and with one tag, and practices the first one a number of times.
    private static async Task AddCardsAsync(string databaseName, int userId, int practiceResults, params string[] spanish)
    {
        await using var dbContext = TestDb.Create(databaseName, userId);
        var tag = new Tag { Name = "Animals" };
        var cards = spanish.Select(word => new FlashCard { Words = TestDb.Words(word, $"the {word}"), Tags = [tag] }).ToList();
        dbContext.Decks.Add(new Deck { Name = "Week 1", FlashCards = cards });
        await dbContext.SaveChangesAsync();
        dbContext.PracticeResults.AddRange(Enumerable.Range(0, practiceResults).Select(_ =>
            new PracticeResult { FlashCardId = cards[0].Id, Outcome = PracticeOutcome.GotIt, PracticedAt = DateTimeOffset.UtcNow }));
        await dbContext.SaveChangesAsync();
    }

    // Sends a signed-in request and returns the activity ASP.NET Core made for it, found by the trace it was sent in.
    private static async Task<Activity> SendAsync(WebApplicationFactory<Program> webFactory, string token)
    {
        var traceId = ActivityTraceId.CreateRandom();
        var requests = new ConcurrentBag<Activity>();
        using var listener = new ActivityListener
        {
            ShouldListenTo = source => source.Name == "Microsoft.AspNetCore",
            Sample = (ref ActivityCreationOptions<ActivityContext> _) => ActivitySamplingResult.AllDataAndRecorded,
            ActivityStopped = activity =>
            {
                if (activity.TraceId == traceId)
                {
                    requests.Add(activity);
                }
            }
        };
        ActivitySource.AddActivityListener(listener);
        using var client = webFactory.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        client.DefaultRequestHeaders.Add("traceparent", $"00-{traceId}-{ActivitySpanId.CreateRandom()}-01");

        using var response = await client.GetAsync("/api/me");

        response.EnsureSuccessStatusCode();
        return Assert.Single(requests);
    }

    private WebApplicationFactory<Program> CreateFactory()
    {
        // Development uses the in-memory database, so the app starts without SQL Server.
        return factory.WithWebHostBuilder(builder => builder
            .UseEnvironment("Development")
            .UseSetting("Authentication:AllowTestSignIn", "true")
            .UseSetting("Authentication:ServiceToken", ServiceToken));
    }

    private sealed class FakeTimeProvider : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 10, 14, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow()
        {
            return Now;
        }
    }

    // Counts the snapshots taken, from the message each one logs when it's done.
    private sealed class SnapshotCountingLogger : ILogger<UsageSnapshotService>
    {
        public int Snapshots { get; private set; }

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull
        {
            return null;
        }

        public bool IsEnabled(LogLevel logLevel)
        {
            return true;
        }

        public void Log<TState>(
            LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (formatter(state, exception).StartsWith("Took usage snapshot", StringComparison.Ordinal))
            {
                Snapshots++;
            }
        }
    }
}
