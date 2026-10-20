using System.Net;
using System.Net.Sockets;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace FlashCardSage.Api.Tests;

public class RemotePictureFetcherTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    private const string PictureUrl = "https://pictures.example/cat.png";

    private readonly RecordingLogger<RemotePictureFetcher> logger = new();

    // The clients CreateFetcher made, disposed after each test.
    private readonly List<HttpClient> httpClients = [];

    [Theory]
    [InlineData("93.184.216.34", true)]
    [InlineData("8.8.8.8", true)]
    [InlineData("100.63.255.255", true)]
    [InlineData("100.128.0.1", true)]
    [InlineData("172.15.255.255", true)]
    [InlineData("172.32.0.1", true)]
    [InlineData("2606:4700:4700::1111", true)]
    [InlineData("::ffff:93.184.216.34", true)]
    [InlineData("64:ff9b::808:808", true)]
    [InlineData("0.0.0.0", false)]
    [InlineData("0.1.2.3", false)]
    [InlineData("10.0.0.1", false)]
    [InlineData("100.64.0.1", false)]
    [InlineData("100.127.255.255", false)]
    [InlineData("127.0.0.1", false)]
    [InlineData("127.255.255.254", false)]
    [InlineData("169.254.169.254", false)]
    [InlineData("172.16.0.1", false)]
    [InlineData("172.31.255.255", false)]
    [InlineData("192.0.0.170", false)]
    [InlineData("192.168.1.1", false)]
    [InlineData("198.18.0.1", false)]
    [InlineData("224.0.0.1", false)]
    [InlineData("240.0.0.1", false)]
    [InlineData("255.255.255.255", false)]
    [InlineData("::", false)]
    [InlineData("::1", false)]
    [InlineData("fc00::1", false)]
    [InlineData("fd00::1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("fec0::1", false)]
    [InlineData("ff02::1", false)]
    [InlineData("::ffff:127.0.0.1", false)]
    [InlineData("::ffff:169.254.169.254", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("64:ff9b::a9fe:a9fe", false)]
    public void IsPublicAddress_RefusesEveryAddressThatIsNotOnThePublicInternet(string address, bool expected)
    {
        Assert.Equal(expected, RemotePictureFetcher.IsPublicAddress(IPAddress.Parse(address)));
    }

    [Theory]
    [InlineData("http://pictures.example/cat.png", "The picture URL must start with https://.")]
    [InlineData("ftp://pictures.example/cat.png", "The picture URL must start with https://.")]
    [InlineData("file:///etc/passwd", "The picture URL must start with https://.")]
    [InlineData("cat.png", "The picture URL isn't a valid absolute URL.")]
    [InlineData("", "The picture URL isn't a valid absolute URL.")]
    [InlineData("https://127.0.0.1/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://0x7f.1/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://10.0.0.5/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://172.16.0.1/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://192.168.1.1/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://169.254.169.254/latest/meta-data/", "The picture URL must be on the public internet.")]
    [InlineData("https://[::1]/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://[fd00::1]/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://[::ffff:127.0.0.1]/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://localhost/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://internal.example/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://metadata.example/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://partly-private.example/cat.png", "The picture URL must be on the public internet.")]
    [InlineData("https://nowhere.example/cat.png", "The picture URL's host can't be found.")]
    public async Task FetchAsync_RefusesUrlsThatDoNotLeadToThePublicInternet_WithoutARequest(string url, string reason)
    {
        var handler = new StubPictureHandler(_ => StubPictureHandler.Picture(SampleImages.Png, "image/png"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(url, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused(reason), result);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task FetchAsync_DownloadsAPicture()
    {
        var handler = new StubPictureHandler(_ => StubPictureHandler.Picture(SampleImages.Png, "image/PNG"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(new Uri(PictureUrl), CancellationToken.None);

        var fetched = Assert.IsType<RemotePictureResult.Fetched>(result);
        Assert.Equal(SampleImages.Png, fetched.Data.ToArray());
        Assert.Equal("image/png", fetched.ContentType);
        var request = Assert.Single(handler.Requests);
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal(new Uri(PictureUrl), request.RequestUri);
        Assert.Equal("image/*", request.Headers.Accept.ToString());
    }

    [Fact]
    public async Task FetchAsync_DownloadsAPictureWithNoContentLength()
    {
        var handler = new StubPictureHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new UnknownLengthContent(SampleImages.Webp, "image/webp")
        });
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        var fetched = Assert.IsType<RemotePictureResult.Fetched>(result);
        Assert.Equal(SampleImages.Webp, fetched.Data.ToArray());
        Assert.Equal("image/webp", fetched.ContentType);
    }

    [Fact]
    public async Task FetchAsync_LogsStatusCodesAndSizesButNeverTheUrl()
    {
        var handler = new StubPictureHandler(url => url.AbsolutePath == "/start"
            ? StubPictureHandler.Redirect("/secret-token-path.png")
            : StubPictureHandler.Picture(SampleImages.Jpeg, "image/jpeg"));
        var fetcher = CreateFetcher(handler);

        await fetcher.FetchAsync("https://pictures.example/start?key=secret", CancellationToken.None);

        Assert.Contains(logger.Entries, entry => Equals(entry.GetValueOrDefault("StatusCode"), 302));
        Assert.Contains(logger.Entries, entry => Equals(entry.GetValueOrDefault("ByteCount"), SampleImages.Jpeg.Length));
        Assert.DoesNotContain(
            logger.Entries.SelectMany(entry => entry.Values).Select(value => value?.ToString() ?? string.Empty),
            value => value.Contains("pictures.example", StringComparison.Ordinal)
                || value.Contains("secret", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(HttpStatusCode.MovedPermanently)]
    [InlineData(HttpStatusCode.Found)]
    [InlineData(HttpStatusCode.SeeOther)]
    [InlineData(HttpStatusCode.TemporaryRedirect)]
    [InlineData(HttpStatusCode.PermanentRedirect)]
    public async Task FetchAsync_FollowsARedirect(HttpStatusCode status)
    {
        var handler = new StubPictureHandler(url => url.Host == "pictures.example"
            ? StubPictureHandler.Redirect("https://cdn.example/cat.png", status)
            : StubPictureHandler.Picture(SampleImages.Png, "image/png"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.IsType<RemotePictureResult.Fetched>(result);
        Assert.Equal([new Uri(PictureUrl), new Uri("https://cdn.example/cat.png")], handler.Urls);
    }

    [Fact]
    public async Task FetchAsync_FollowsARelativeRedirect()
    {
        var handler = new StubPictureHandler(url => url.AbsolutePath == "/cat.png"
            ? StubPictureHandler.Redirect("/images/cat.png")
            : StubPictureHandler.Picture(SampleImages.Png, "image/png"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.IsType<RemotePictureResult.Fetched>(result);
        Assert.Equal(new Uri("https://pictures.example/images/cat.png"), handler.Urls.Last());
    }

    [Fact]
    public async Task FetchAsync_RefusesARedirectToHttp()
    {
        var handler = new StubPictureHandler(_ => StubPictureHandler.Redirect("http://pictures.example/cat.png"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused("The picture URL must start with https://."), result);
        Assert.Single(handler.Requests);
    }

    [Theory]
    [InlineData("https://169.254.169.254/latest/meta-data/")]
    [InlineData("https://internal.example/cat.png")]
    public async Task FetchAsync_RefusesARedirectAwayFromThePublicInternet(string location)
    {
        var handler = new StubPictureHandler(_ => StubPictureHandler.Redirect(location));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused("The picture URL must be on the public internet."), result);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task FetchAsync_FollowsUpToThreeRedirects()
    {
        var handler = new StubPictureHandler(url => url.AbsolutePath switch
        {
            "/3" => StubPictureHandler.Picture(SampleImages.Png, "image/png"),
            "/2" => StubPictureHandler.Redirect("/3"),
            "/1" => StubPictureHandler.Redirect("/2"),
            _ => StubPictureHandler.Redirect("/1")
        });
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.IsType<RemotePictureResult.Fetched>(result);
        Assert.Equal(4, handler.Requests.Count);
    }

    [Fact]
    public async Task FetchAsync_RefusesAFourthRedirect()
    {
        var handler = new StubPictureHandler(url => StubPictureHandler.Redirect(url.AbsolutePath + "x"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused("The picture URL redirected too many times."), result);
        Assert.Equal(RemotePictureFetcher.MaxRedirects + 1, handler.Requests.Count);
    }

    [Fact]
    public async Task FetchAsync_RefusesARedirectWithNoLocation()
    {
        var handler = new StubPictureHandler(_ => new HttpResponseMessage(HttpStatusCode.Found));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused("The picture URL redirected nowhere."), result);
    }

    [Theory]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Forbidden)]
    [InlineData(HttpStatusCode.InternalServerError)]
    public async Task FetchAsync_RefusesAnErrorStatus(HttpStatusCode status)
    {
        var handler = new StubPictureHandler(_ => new HttpResponseMessage(status));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused($"The picture URL answered {(int)status}."), result);
    }

    [Theory]
    [InlineData("text/html")]
    [InlineData("image/gif")]
    [InlineData("image/svg+xml")]
    [InlineData("application/octet-stream")]
    public async Task FetchAsync_RefusesAContentTypeACardCanNotHave(string contentType)
    {
        var handler = new StubPictureHandler(_ => StubPictureHandler.Picture(SampleImages.Png, contentType));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(
            new RemotePictureResult.Refused("The picture URL must lead to a JPEG, PNG or WebP picture."), result);
    }

    [Fact]
    public async Task FetchAsync_RefusesAnAnswerWithNoContentType()
    {
        var handler = new StubPictureHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(SampleImages.Png)
        });
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(
            new RemotePictureResult.Refused("The picture URL must lead to a JPEG, PNG or WebP picture."), result);
    }

    [Fact]
    public async Task FetchAsync_RefusesAContentLengthOverTheLimit()
    {
        var handler = new StubPictureHandler(_ =>
        {
            var response = StubPictureHandler.Picture(SampleImages.Png, "image/png");
            response.Content.Headers.ContentLength = CardImage.MaxBytes + 1;
            return response;
        });
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused(CardImage.TooBigMessage), result);
    }

    [Fact]
    public async Task FetchAsync_RefusesABodyOverTheLimit()
    {
        var bytes = new byte[CardImage.MaxBytes + 1];
        SampleImages.Png.CopyTo(bytes, 0);
        var handler = new StubPictureHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new UnknownLengthContent(bytes, "image/png")
        });
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused(CardImage.TooBigMessage), result);
    }

    [Fact]
    public async Task FetchAsync_DownloadsAPictureRightAtTheLimit()
    {
        var bytes = new byte[CardImage.MaxBytes];
        SampleImages.Png.CopyTo(bytes, 0);
        var handler = new StubPictureHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new UnknownLengthContent(bytes, "image/png")
        });
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(CardImage.MaxBytes, Assert.IsType<RemotePictureResult.Fetched>(result).Data.Length);
    }

    [Fact]
    public async Task FetchAsync_RefusesAPictureThatIsNotWhatItsContentTypeSays()
    {
        var handler = new StubPictureHandler(_ => StubPictureHandler.Picture(SampleImages.Jpeg, "image/png"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(
            new RemotePictureResult.Refused("The picture isn't the kind of image its content type says."), result);
    }

    [Fact]
    public async Task FetchAsync_RefusesAnEmptyPicture()
    {
        var handler = new StubPictureHandler(_ => StubPictureHandler.Picture([], "image/png"));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused("The picture is empty."), result);
    }

    [Fact]
    public async Task FetchAsync_RefusesAPictureThatTakesTooLong()
    {
        var handler = new StubPictureHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return StubPictureHandler.Picture(SampleImages.Png, "image/png");
        });
        var fetcher = CreateFetcher(handler, TimeSpan.FromMilliseconds(100));

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused("The picture took too long to download."), result);
    }

    [Fact]
    public async Task FetchAsync_StopsWhenTheCallerCancels()
    {
        var handler = new StubPictureHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return StubPictureHandler.Picture(SampleImages.Png, "image/png");
        });
        var fetcher = CreateFetcher(handler);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => fetcher.FetchAsync(PictureUrl, cancellation.Token));
    }

    [Fact]
    public async Task FetchAsync_RefusesAFailedConnection()
    {
        var handler = new StubPictureHandler(
            (_, _) => Task.FromException<HttpResponseMessage>(new HttpRequestException("No such host (pictures.example)")));
        var fetcher = CreateFetcher(handler);

        var result = await fetcher.FetchAsync(PictureUrl, CancellationToken.None);

        Assert.Equal(new RemotePictureResult.Refused("The picture couldn't be downloaded."), result);
    }

    // A name that resolves somewhere public for the check and somewhere private for the connection (DNS rebinding) gets
    // nowhere: the handler looks the name up again and refuses the connection.
    [Fact]
    public async Task FetchAsync_RefusesAConnectionToAPrivateAddress()
    {
        // Something listening on loopback, which the connection would reach if it weren't refused.
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        try
        {
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            var connectResolver = new FakeHostAddressResolver(
                new Dictionary<string, string[]> { ["pictures.example"] = ["127.0.0.1"] });
            using var handler = RemotePictureFetcher.CreateHandler(connectResolver);
            using var httpClient = new HttpClient(handler) { Timeout = RemotePictureFetcher.Timeout };
            var fetcher = new RemotePictureFetcher(httpClient, new FakeHostAddressResolver(), logger);

            var result = await fetcher.FetchAsync($"https://pictures.example:{port}/cat.png", CancellationToken.None);

            Assert.Equal(new RemotePictureResult.Refused("The picture couldn't be downloaded."), result);
            Assert.False(listener.Pending());
        }
        finally
        {
            listener.Stop();
        }
    }

    [Fact]
    public void CreateHandler_DoesNotFollowRedirectsOrKeepCookiesOrUseAProxy()
    {
        using var handler = RemotePictureFetcher.CreateHandler(new FakeHostAddressResolver());

        Assert.False(handler.AllowAutoRedirect);
        Assert.False(handler.UseCookies);
        Assert.False(handler.UseProxy);
        Assert.NotNull(handler.ConnectCallback);
    }

    [Fact]
    public void AddRemotePictureFetcher_RegistersTheTypedClient()
    {
        using var app = TestApp.CreateFactory(factory);

        var fetcher = app.Services.GetRequiredService<RemotePictureFetcher>();

        Assert.NotNull(fetcher);
        Assert.IsType<DnsHostAddressResolver>(app.Services.GetRequiredService<IHostAddressResolver>());
    }

    // A fetcher that sends through the handler and resolves names with the fake resolver: internal.example to a private
    // address, metadata.example to the cloud metadata endpoint, partly-private.example to a public and a private one,
    // localhost to loopback, nowhere.example to nothing, and anything else to a public address.
    private RemotePictureFetcher CreateFetcher(HttpMessageHandler handler, TimeSpan? timeout = null)
    {
        var resolver = new FakeHostAddressResolver(new Dictionary<string, string[]>
        {
            ["internal.example"] = ["10.1.2.3"],
            ["metadata.example"] = ["169.254.169.254"],
            ["partly-private.example"] = [FakeHostAddressResolver.PublicAddress, "192.168.0.10"],
            ["localhost"] = ["127.0.0.1", "::1"],
            ["nowhere.example"] = []
        });
        var httpClient = new HttpClient(handler) { Timeout = timeout ?? RemotePictureFetcher.Timeout };
        httpClients.Add(httpClient);
        return new RemotePictureFetcher(httpClient, resolver, logger);
    }

    public void Dispose()
    {
        foreach (var httpClient in httpClients)
        {
            httpClient.Dispose();
        }

        GC.SuppressFinalize(this);
    }
}
