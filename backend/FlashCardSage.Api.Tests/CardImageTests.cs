using FlashCardSage.Api.Images;
using FlashCardSage.Api.Tests.TestData;

namespace FlashCardSage.Api.Tests;

public class CardImageTests
{
    public static TheoryData<string, byte[]> Kinds => new()
    {
        { "image/jpeg", SampleImages.Jpeg },
        { "image/png", SampleImages.Png },
        { "image/webp", SampleImages.Webp }
    };

    [Theory]
    [MemberData(nameof(Kinds))]
    public void TryDecode_DecodesEachKindOfPicture(string contentType, byte[] bytes)
    {
        var decoded = CardImage.TryDecode(
            contentType, Convert.ToBase64String(bytes), out var data, out var normalized, out var error);

        Assert.True(decoded, error);
        Assert.Equal(bytes, data.ToArray());
        Assert.Equal(contentType, normalized);
        Assert.Equal(string.Empty, error);
    }

    [Fact]
    public void TryDecode_TidiesTheContentType()
    {
        var decoded = CardImage.TryDecode(" Image/PNG ", Convert.ToBase64String(SampleImages.Png), out _, out var normalized, out _);

        Assert.True(decoded);
        Assert.Equal("image/png", normalized);
    }

    [Theory]
    [InlineData("image/gif")]
    [InlineData("text/html")]
    [InlineData("")]
    [InlineData(null)]
    public void TryDecode_RefusesOtherKindsOfFile(string? contentType)
    {
        var decoded = CardImage.TryDecode(contentType, Convert.ToBase64String(SampleImages.Png), out _, out _, out var error);

        Assert.False(decoded);
        Assert.Equal("The picture must be a JPEG, PNG or WebP.", error);
    }

    [Fact]
    public void TryDecode_RefusesAPictureThatIsNotWhatItsContentTypeSays()
    {
        var decoded = CardImage.TryDecode("image/jpeg", Convert.ToBase64String(SampleImages.Png), out _, out _, out var error);

        Assert.False(decoded);
        Assert.Equal("The picture isn't the kind of image its content type says.", error);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void TryDecode_RefusesNothing(string? base64)
    {
        var decoded = CardImage.TryDecode("image/png", base64, out _, out _, out var error);

        Assert.False(decoded);
        Assert.Equal("The picture is empty.", error);
    }

    [Fact]
    public void TryDecode_RefusesTextThatIsNotBase64()
    {
        var decoded = CardImage.TryDecode("image/png", "not base64!", out _, out _, out var error);

        Assert.False(decoded);
        Assert.Equal("The picture isn't valid base64.", error);
    }

    [Fact]
    public void TryDecode_RefusesAPictureOverTheLimit()
    {
        var bytes = new byte[CardImage.MaxBytes + 1];
        SampleImages.Png.CopyTo(bytes, 0);

        var decoded = CardImage.TryDecode("image/png", Convert.ToBase64String(bytes), out _, out _, out var error);

        Assert.False(decoded);
        Assert.Equal("The picture can be at most 5 MB.", error);
    }

    [Fact]
    public void TryDecode_AcceptsAPictureAtTheLimit()
    {
        var bytes = new byte[CardImage.MaxBytes];
        SampleImages.Png.CopyTo(bytes, 0);

        var decoded = CardImage.TryDecode("image/png", Convert.ToBase64String(bytes), out var data, out _, out var error);

        Assert.True(decoded, error);
        Assert.Equal(CardImage.MaxBytes, data.Length);
    }

    [Fact]
    public void TryValidate_RefusesAudio()
    {
        var valid = CardImage.TryValidate(new byte[] { 0xFF, 0xFB, 0x90, 0xC0 }, "audio/mpeg", out _, out var error);

        Assert.False(valid);
        Assert.Equal("The picture must be a JPEG, PNG or WebP.", error);
    }

    [Theory]
    [InlineData("image/jpeg", "jpg")]
    [InlineData("image/png", "png")]
    [InlineData("image/webp", "webp")]
    [InlineData("audio/mpeg", "mp3")]
    public void ContentName_IsTheContentsHashWithTheKindsExtension(string contentType, string extension)
    {
        var name = CardImage.ContentName([1, 2, 3], contentType);

        Assert.Equal(name, CardImage.ContentName([1, 2, 3], contentType));
        Assert.NotEqual(name, CardImage.ContentName([1, 2, 4], contentType));
        Assert.Matches($@"^[0-9a-f]{{32}}\.{extension}$", name);
        Assert.True(CardImage.IsName(name));
        Assert.Equal(contentType, CardImage.ContentTypeOf(name));
    }

    [Theory]
    [InlineData("image/jpeg", "jpg")]
    [InlineData("image/png", "png")]
    [InlineData("image/webp", "webp")]
    [InlineData("audio/mpeg", "mp3")]
    public void NewName_IsRandomWithTheKindsExtension(string contentType, string extension)
    {
        var first = CardImage.NewName(contentType);
        var second = CardImage.NewName(contentType);

        Assert.NotEqual(first, second);
        Assert.Matches($@"^[0-9a-f]{{32}}\.{extension}$", first);
        Assert.True(CardImage.IsName(first));
    }

    [Theory]
    [InlineData("../appsettings.json")]
    [InlineData("0123456789abcdef0123456789abcdef.exe")]
    [InlineData("0123456789ABCDEF0123456789ABCDEF.jpg")]
    [InlineData("")]
    public void IsName_RefusesAnythingButANewName(string name)
    {
        Assert.False(CardImage.IsName(name));
    }
}
