using System.Data.Common;
using System.Text.Json;
using Azure;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace FlashCardSage.Api.SystemDecks;

/// <summary>
/// Puts the built-in cards' pictures (see SystemDeckImages) on them, in the image store, and in the cache of generated
/// pictures, which users' cards share them through. A picture is kept under a name from its content, so a card whose
/// URL already ends with it is left alone, and a changed picture replaces the old one. Running it again does no harm.
/// </summary>
public static class SystemDeckImageSync
{
    /// <summary>
    /// Gives each built-in card the picture it should have. The current user becomes the system user, as in
    /// SystemDeckSeeder, so the context shouldn't be used for anything else afterwards.
    /// </summary>
    /// <returns>How many cards got a new picture.</returns>
    public static async Task<int> SyncAsync(
        FlashCardDbContext dbContext,
        CurrentUser currentUser,
        IImageStore imageStore,
        IReadOnlyList<SystemCardImage> images,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dbContext);
        ArgumentNullException.ThrowIfNull(currentUser);
        ArgumentNullException.ThrowIfNull(imageStore);
        ArgumentNullException.ThrowIfNull(images);
        ArgumentNullException.ThrowIfNull(logger);

        if (images.Count == 0)
        {
            return 0;
        }

        await UserAccounts.BecomeSystemUserAsync(dbContext, currentUser, cancellationToken);

        var imagesBySpanish = images
            .GroupBy(image => image.Spanish, TextRules.Comparer)
            .ToDictionary(group => group.Key, group => group.First(), TextRules.Comparer);
        var cards = await dbContext.FlashCards.WithWords().ToListAsync(cancellationToken);
        var replaced = new List<string>();
        var updated = 0;

        foreach (var card in cards)
        {
            // A word is only ever on one card, so the picture of any of the card's Spanish words is this card's.
            var image = card.Spanish
                .Select(word => imagesBySpanish.GetValueOrDefault(word))
                .FirstOrDefault(item => item is not null);
            if (image is null)
            {
                continue;
            }

            var data = await File.ReadAllBytesAsync(image.Path, cancellationToken);
            var name = CardImage.ContentName(data, CardImage.ContentTypeOf(image.Path));
            if (card.ImageUrl?.EndsWith("/" + name, StringComparison.Ordinal) == true)
            {
                continue;
            }

            var url = await imageStore.SaveAsync(name, data, cancellationToken);
            if (card.ImageUrl is { } oldUrl)
            {
                replaced.Add(oldUrl);
            }

            card.ImageUrl = url;
            updated++;
        }

        // Every built-in picture is in the cache, so users who add the card share it, and anyone asking for a picture
        // of its words is shown it first. Cards that had theirs already are added too, for pictures from before the
        // cache.
        await CachedImageGenerator.AddCardPicturesAsync(dbContext, cards, cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);

        // Only once the cards point at their new pictures, so a card never points at one that's gone. An old picture
        // that's in the cache stays, since users' cards share it.
        await imageStore.TryDeleteCardPicturesAsync(dbContext, replaced, logger, cancellationToken);

        return updated;
    }
}

/// <summary>
/// Runs SystemDeckImageSync once the API has started: after the server is listening, so the local image store knows
/// its address, and without holding up the start, since the first time it uploads every picture.
/// </summary>
public sealed class SystemDeckImageSyncService(
    IServiceScopeFactory scopeFactory,
    IHostApplicationLifetime lifetime,
    ILogger<SystemDeckImageSyncService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await WhenStartedAsync(stoppingToken);

            using var scope = scopeFactory.CreateScope();
            var updated = await SystemDeckImageSync.SyncAsync(
                scope.ServiceProvider.GetRequiredService<FlashCardDbContext>(),
                scope.ServiceProvider.GetRequiredService<CurrentUser>(),
                scope.ServiceProvider.GetRequiredService<IImageStore>(),
                SystemDeckImages.Load(SystemDeckImages.Directory),
                logger,
                stoppingToken);
            logger.LogInformation("Gave {Count} built-in cards their pictures", updated);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The API is stopping. The next start carries on.
        }
        // The database, the pictures' files or the image store (blob storage, or the local folder before the server
        // has an address) failing. The pictures are a nicety, so none of these stops the API; the next start tries
        // again.
        catch (Exception ex) when (ex is DbException or DbUpdateException or RetryLimitExceededException
            or IOException or UnauthorizedAccessException or JsonException or RequestFailedException
            or InvalidOperationException)
        {
            logger.LogWarning(ex, "Could not give the built-in cards their pictures");
        }
    }

    private async Task WhenStartedAsync(CancellationToken stoppingToken)
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var onStarted = lifetime.ApplicationStarted.Register(() => started.TrySetResult());
        await started.Task.WaitAsync(stoppingToken);
    }
}
