using System.Threading.Channels;
using FlashCardSage.Api.Data;

namespace FlashCardSage.Api.Usage;

/// <summary>
/// Takes a <see cref="UsageSnapshot"/> at most once every <see cref="Interval"/>, and only when a signed-in request asks
/// for one (see CurrentUserMiddleware). That request has just read the database, so a snapshot never wakes the
/// serverless database from auto-pause. Nothing a snapshot counts changes without a signed-in request, so one is never
/// missed while nobody uses the app.
/// </summary>
public class UsageSnapshotService(
    IServiceScopeFactory scopeFactory,
    TimeProvider timeProvider,
    ILogger<UsageSnapshotService> logger) : BackgroundService
{
    public static readonly TimeSpan Interval = TimeSpan.FromHours(6);

    // A request only needs to say a snapshot may be due, so one waiting request is as good as many.
    private readonly Channel<bool> requests = Channel.CreateBounded<bool>(
        new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropWrite });

    private DateTimeOffset? lastTakenAt;

    public void RequestSnapshot()
    {
        requests.Writer.TryWrite(true);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var _ in requests.Reader.ReadAllAsync(stoppingToken))
            {
                await TakeIfDueAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The app is stopping.
        }
    }

    public async Task TakeIfDueAsync(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        if (lastTakenAt is { } last && now - last < Interval)
        {
            return;
        }

        // Even a failed snapshot waits for the next interval, so a broken one doesn't run on every request.
        lastTakenAt = now;

        try
        {
            using var scope = scopeFactory.CreateScope();
            await UsageSnapshot.TakeAsync(
                scope.ServiceProvider.GetRequiredService<FlashCardDbContext>(), logger, now, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "Taking a usage snapshot failed");
        }
    }
}
