using FlashCardSage.Api.Images;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class ImageStoreExtensionsTests
{
    [Fact]
    public async Task TryDeleteAllAsync_DeletesEachPicture_SkippingCardsWithNone()
    {
        var store = new FakeImageStore();

        await store.TryDeleteAllAsync(
            [FakeImageStore.BaseUrl + "1.jpg", null, FakeImageStore.BaseUrl + "2.jpg"],
            NullLogger.Instance,
            CancellationToken.None);

        Assert.Equal([FakeImageStore.BaseUrl + "1.jpg", FakeImageStore.BaseUrl + "2.jpg"], store.Deleted);
    }

    [Fact]
    public async Task TryDeleteAllAsync_CarriesOn_WhenAPictureCannotBeRemoved()
    {
        var store = new FakeImageStore { DeleteFailure = new IOException("Storage is down.") };

        await store.TryDeleteAllAsync(
            [FakeImageStore.BaseUrl + "1.jpg", FakeImageStore.BaseUrl + "2.jpg"],
            NullLogger.Instance,
            CancellationToken.None);

        Assert.Equal(2, store.Deleted.Count);
    }
}
