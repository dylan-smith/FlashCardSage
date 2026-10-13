using FlashCardSage.Api.Images;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public sealed class LocalFileImageStoreTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), $"FlashCardSage-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Directory_IsTheLocalPathUnderTheContentRoot()
    {
        var store = CreateStore("App_Data/pictures");

        Assert.Equal(Path.GetFullPath(Path.Combine(root, "App_Data", "pictures")), store.Directory);
    }

    [Fact]
    public void Directory_IsAnAbsoluteLocalPathAsItIs()
    {
        var elsewhere = Path.Combine(root, "elsewhere");

        var store = CreateStore(elsewhere);

        Assert.Equal(elsewhere, store.Directory);
    }

    [Fact]
    public async Task SaveAsync_WritesTheFile_AndNamesItOnTheRequestsAddress()
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);

        var url = await store.SaveAsync(CardImageTests.Png, "image/png", CancellationToken.None);

        Assert.Matches(@"^http://localhost:5269/card-images/[0-9a-f]{32}\.png$", url);
        var file = Path.Combine(store.Directory, url["http://localhost:5269/card-images/".Length..]);
        Assert.Equal(CardImageTests.Png, await File.ReadAllBytesAsync(file));
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheFile_AndLeavesTheRest()
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);
        var url = await store.SaveAsync(CardImageTests.Png, "image/png", CancellationToken.None);
        var other = await store.SaveAsync(CardImageTests.Jpeg, "image/jpeg", CancellationToken.None);

        await store.DeleteAsync(url, CancellationToken.None);

        Assert.Equal([Path.GetFileName(other)], Directory.GetFiles(store.Directory).Select(Path.GetFileName));
    }

    [Theory]
    [InlineData("http://localhost:5269/card-images/../0123456789abcdef0123456789abcdef.png")]
    [InlineData("http://localhost:5269/card-images/keep.png")]
    [InlineData("http://localhost:5269/elsewhere/0123456789abcdef0123456789abcdef.png")]
    [InlineData("not a url")]
    public async Task DeleteAsync_LeavesAnythingThatIsNotItsOwn(string url)
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);
        var keep = Path.Combine(store.Directory, "keep.png");
        await File.WriteAllBytesAsync(keep, CardImageTests.Png);
        var named = Path.Combine(store.Directory, "0123456789abcdef0123456789abcdef.png");
        await File.WriteAllBytesAsync(named, CardImageTests.Png);

        await store.DeleteAsync(url, CancellationToken.None);

        Assert.True(File.Exists(keep));
        Assert.True(File.Exists(named));
    }

    [Fact]
    public async Task DeleteAsync_IsFine_WhenTheFileIsAlreadyGone()
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);

        await store.DeleteAsync(
            "http://localhost:5269/card-images/0123456789abcdef0123456789abcdef.png", CancellationToken.None);
    }

    private LocalFileImageStore CreateStore(string localPath)
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("localhost", 5269);
        return new LocalFileImageStore(
            Options.Create(new ImageStoreOptions { LocalPath = localPath }),
            new FakeEnvironment(root),
            new HttpContextAccessor { HttpContext = context });
    }

    private sealed class FakeEnvironment(string contentRootPath) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;

        public string ApplicationName { get; set; } = "FlashCardSage.Api";

        public string ContentRootPath { get; set; } = contentRootPath;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
