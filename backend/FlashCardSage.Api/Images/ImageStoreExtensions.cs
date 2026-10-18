namespace FlashCardSage.Api.Images;

public static class ImageStoreExtensions
{
    // Removes a picture that's no longer on a card, as far as the store can. The card is what matters, and it's
    // already been saved without the picture, so a picture that can't be removed is logged and left behind rather
    // than failing the request.
    public static async Task TryDeleteAsync(
        this IImageStore store, string url, ILogger logger, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(logger);
        try
        {
            await store.DeleteAsync(url, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "A picture that's no longer on a card couldn't be removed, so it's left behind");
        }
    }

    // Removes the pictures that are no longer on cards, one at a time, as TryDeleteAsync does, skipping the cards that
    // had none (a null URL).
    public static async Task TryDeleteAllAsync(
        this IImageStore store, IEnumerable<string?> urls, ILogger logger, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(urls);
        foreach (var url in urls.OfType<string>())
        {
            await store.TryDeleteAsync(url, logger, cancellationToken);
        }
    }
}
