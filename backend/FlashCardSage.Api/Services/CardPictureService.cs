using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Puts a picture on one of the user's cards or takes it off (see FlashCardImagesController). A card given a generated
/// picture points at it in the cache, which every card with that picture shares and nothing removes; a picture the user
/// uploads is the card's own, and goes when the card's done with it.
/// </summary>
/// <remarks>
/// A card is always looked up first, since that's what limits it to the current user's cards. Log statements include
/// ids and sizes only.
/// </remarks>
public class CardPictureService(
    FlashCardDbContext dbContext,
    IImageStore imageStore,
    ILogger<CardPictureService> logger)
{
    // Puts a picture of the user's own on the card, such as one they uploaded, replacing any it had.
    public async Task<PictureResult> PutAsync(
        int cardId, ReadOnlyMemory<byte> data, string contentType, CancellationToken cancellationToken)
    {
        var card = await FindCardAsync(cardId, cancellationToken);
        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for a picture", cardId);
            return new PictureResult.NotFound();
        }

        if (!CardImage.TryValidate(data, contentType, out var normalizedContentType, out var error))
        {
            return new PictureResult.Invalid("Data", error);
        }

        var previousUrl = card.ImageUrl;
        var url = await imageStore.SaveAsync(data, normalizedContentType, cancellationToken);
        card.ImageUrl = url;
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            // The picture isn't on the card, so it isn't kept either.
            await imageStore.TryDeleteAsync(url, logger, CancellationToken.None);
            throw;
        }

        logger.LogInformation("Put a {Length} byte picture on flash card {FlashCardId}", data.Length, cardId);

        await DeletePreviousAsync(card, previousUrl, cancellationToken);
        return new PictureResult.Changed(card);
    }

    // Points the card at a generated picture, which is in the cache already, rather than keeping a copy.
    public async Task<PictureResult> PutGeneratedAsync(
        int cardId, int generatedImageId, CancellationToken cancellationToken)
    {
        var card = await FindCardAsync(cardId, cancellationToken);
        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for a picture", cardId);
            return new PictureResult.NotFound();
        }

        var cached = await dbContext.GeneratedImages
            .AsNoTracking()
            .FirstOrDefaultAsync(item => item.Id == generatedImageId, cancellationToken);
        if (cached is null)
        {
            return new PictureResult.Invalid("GeneratedImageId", "That picture is gone.");
        }

        var previousUrl = card.ImageUrl;
        card.ImageUrl = cached.ImageUrl;
        await dbContext.SaveChangesAsync(cancellationToken);
        logger.LogInformation(
            "Put generated picture {GeneratedImageId} on flash card {FlashCardId}", generatedImageId, cardId);

        await DeletePreviousAsync(card, previousUrl, cancellationToken);
        return new PictureResult.Changed(card);
    }

    // Takes the card's picture off, if it has one.
    public async Task<PictureResult> RemoveAsync(int cardId, CancellationToken cancellationToken)
    {
        var card = await FindCardAsync(cardId, cancellationToken);
        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for removing its picture", cardId);
            return new PictureResult.NotFound();
        }

        if (card.ImageUrl is { } url)
        {
            card.ImageUrl = null;
            await dbContext.SaveChangesAsync(cancellationToken);
            await imageStore.TryDeleteCardPicturesAsync(dbContext, [url], logger, cancellationToken);
            logger.LogInformation("Removed the picture from flash card {FlashCardId}", cardId);
        }

        return new PictureResult.Changed(card);
    }

    // Removes the card's old picture once it has a new one, unless it's a cached one.
    private async Task DeletePreviousAsync(FlashCard card, string? previousUrl, CancellationToken cancellationToken)
    {
        if (previousUrl is not null && previousUrl != card.ImageUrl)
        {
            await imageStore.TryDeleteCardPicturesAsync(dbContext, [previousUrl], logger, cancellationToken);
        }
    }

    // The card with its words and tags, as the other endpoints return it.
    private Task<FlashCard?> FindCardAsync(int id, CancellationToken cancellationToken)
    {
        return dbContext.FlashCards
            .WithWordsAndTags()
            .FirstOrDefaultAsync(card => card.Id == id, cancellationToken);
    }
}
