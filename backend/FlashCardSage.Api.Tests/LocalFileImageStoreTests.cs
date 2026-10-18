using FlashCardSage.Api.Images;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests;

public sealed class LocalFileImageStoreTests : IDisposable
{
    private readonly string root = Path.Join(Path.GetTempPath(), $"FlashCardSage-{Guid.NewGuid():N}");

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

        Assert.Equal(Path.GetFullPath(Path.Join(root, "App_Data", "pictures")), store.Directory);
    }

    [Fact]
    public void Directory_IsAnAbsoluteLocalPathAsItIs()
    {
        var elsewhere = Path.Join(root, "elsewhere");

        var store = CreateStore(elsewhere);

        Assert.Equal(elsewhere, store.Directory);
    }

    [Fact]
    public async Task SaveAsync_WritesTheFile_AndNamesItOnTheRequestsAddress()
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);

        var url = await store.SaveAsync(SampleImages.Png, "image/png", CancellationToken.None);

        Assert.Matches(@"^http://localhost:5269/card-images/[0-9a-f]{32}\.png$", url);
        var file = Assert.Single(Directory.GetFiles(store.Directory));
        Assert.EndsWith("/" + Path.GetFileName(file), url, StringComparison.Ordinal);
        Assert.Equal(SampleImages.Png, await File.ReadAllBytesAsync(file));
    }

    [Fact]
    public async Task DeleteAsync_RemovesTheFile_AndLeavesTheRest()
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);
        var url = await store.SaveAsync(SampleImages.Png, "image/png", CancellationToken.None);
        var other = await store.SaveAsync(SampleImages.Jpeg, "image/jpeg", CancellationToken.None);

        await store.DeleteAsync(url, CancellationToken.None);

        Assert.Equal([Path.GetFileName(other)], Directory.GetFiles(store.Directory).Select(Path.GetFileName));
    }

    [Fact]
    public async Task CopyAsync_WritesTheSamePictureUnderANewName()
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);
        var url = await store.SaveAsync(SampleImages.Jpeg, "image/jpeg", CancellationToken.None);

        var copy = await store.CopyAsync(url, CancellationToken.None);

        Assert.NotNull(copy);
        Assert.Matches(@"^http://localhost:5269/card-images/[0-9a-f]{32}\.jpg$", copy);
        Assert.NotEqual(url, copy);
        // The files are found by listing the folder, like the save test, rather than from the URLs.
        var files = Directory.GetFiles(store.Directory);
        Assert.Equal(2, files.Length);
        Assert.Contains(files, file => copy.EndsWith("/" + Path.GetFileName(file), StringComparison.Ordinal));
        foreach (var file in files)
        {
            Assert.Equal(SampleImages.Jpeg, await File.ReadAllBytesAsync(file));
        }
    }

    [Theory]
    [InlineData("http://localhost:5269/card-images/0123456789abcdef0123456789abcdef.png")]
    [InlineData("http://localhost:5269/card-images/keep.png")]
    [InlineData("not a url")]
    public async Task CopyAsync_ReturnsNull_ForAPictureThatIsGoneOrNotItsOwn(string url)
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);
        await File.WriteAllBytesAsync(Path.Join(store.Directory, "keep.png"), SampleImages.Png);

        Assert.Null(await store.CopyAsync(url, CancellationToken.None));
        Assert.Single(Directory.GetFiles(store.Directory));
    }

    [Fact]
    public async Task LoadAsync_ReadsThePictureBack()
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);
        var url = await store.SaveAsync(SampleImages.Jpeg, "image/jpeg", CancellationToken.None);

        var data = await store.LoadAsync(url, CancellationToken.None);

        Assert.Equal(SampleImages.Jpeg, data?.ToArray());
    }

    [Theory]
    [InlineData("http://localhost:5269/card-images/0123456789abcdef0123456789abcdef.png")]
    [InlineData("http://localhost:5269/card-images/keep.png")]
    [InlineData("not a url")]
    public async Task LoadAsync_ReturnsNull_ForAPictureThatIsGoneOrNotItsOwn(string url)
    {
        var store = CreateStore("pictures");
        Directory.CreateDirectory(store.Directory);
        await File.WriteAllBytesAsync(Path.Join(store.Directory, "keep.png"), SampleImages.Png);

        Assert.Null(await store.LoadAsync(url, CancellationToken.None));
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
        var keep = Path.Join(store.Directory, "keep.png");
        await File.WriteAllBytesAsync(keep, SampleImages.Png);
        var named = Path.Join(store.Directory, "0123456789abcdef0123456789abcdef.png");
        await File.WriteAllBytesAsync(named, SampleImages.Png);

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

    [Fact]
    public async Task SaveAsync_WithAName_WritesTheFileOnce_AndNamesItOnTheServersAddressOutsideARequest()
    {
        var store = CreateStore("pictures", inRequest: false, "http://[::]:5269");
        Directory.CreateDirectory(store.Directory);
        const string name = "0123456789abcdef0123456789abcdef.jpg";

        var url = await store.SaveAsync(name, SampleImages.Jpeg, CancellationToken.None);
        var again = await store.SaveAsync(name, SampleImages.Png, CancellationToken.None);

        Assert.Equal($"http://localhost:5269/card-images/{name}", url);
        Assert.Equal(url, again);
        // A picture that's there already is left as it is.
        Assert.Equal(SampleImages.Jpeg, await File.ReadAllBytesAsync(Path.Join(store.Directory, name)));
    }

    [Fact]
    public async Task SaveAsync_Throws_OutsideARequestBeforeTheServerListens()
    {
        var store = CreateStore("pictures", inRequest: false);
        Directory.CreateDirectory(store.Directory);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            store.SaveAsync("0123456789abcdef0123456789abcdef.jpg", SampleImages.Jpeg, CancellationToken.None));
        Assert.Empty(Directory.GetFiles(store.Directory));
    }

    private LocalFileImageStore CreateStore(string localPath, bool inRequest = true, params string[] serverAddresses)
    {
        var accessor = new HttpContextAccessor();
        if (inRequest)
        {
            var context = new DefaultHttpContext();
            context.Request.Scheme = "http";
            context.Request.Host = new HostString("localhost", 5269);
            accessor.HttpContext = context;
        }

        var addresses = new ServerAddressesFeature();
        foreach (var address in serverAddresses)
        {
            addresses.Addresses.Add(address);
        }

        var features = new FeatureCollection();
        if (serverAddresses.Length > 0)
        {
            features.Set<IServerAddressesFeature>(addresses);
        }

        return new LocalFileImageStore(
            Options.Create(new ImageStoreOptions { LocalPath = localPath }),
            new FakeEnvironment(root),
            accessor,
            new FakeServer(features));
    }

    // A server that only has features, like Kestrel's addresses once it listens.
    private sealed class FakeServer(IFeatureCollection features) : IServer
    {
        public IFeatureCollection Features { get; } = features;

        public Task StartAsync<TContext>(IHttpApplication<TContext> application, CancellationToken cancellationToken)
            where TContext : notnull
        {
            return Task.CompletedTask;
        }

        public Task StopAsync(CancellationToken cancellationToken)
        {
            return Task.CompletedTask;
        }

        public void Dispose()
        {
        }
    }

    private sealed class FakeEnvironment(string contentRootPath) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;

        public string ApplicationName { get; set; } = "FlashCardSage.Api";

        public string ContentRootPath { get; set; } = contentRootPath;

        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
