using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace FlashCardSage.Api.Images;

// The pictures a card can have: the kinds of image, how big one can be, and the names they're kept under. The names
// also cover the spoken audio of cards' Spanish (see Speech), which the image store keeps alongside the pictures.
public static partial class CardImage
{
    // Room for a photo the user uploads. A compressed JPEG from the generator is around a hundred kilobytes. The
    // frontend checks the same limit before sending one.
    public const int MaxBytes = 5 * 1024 * 1024;

    public const string TooBigMessage = "The picture can be at most 5 MB.";

    // The most characters the base64 of a picture within the limit can take.
    private const int MaxBase64Length = (MaxBytes + 2) / 3 * 4;

    // Each kind of picture's file extension.
    private static readonly Dictionary<string, string> Extensions = new(StringComparer.Ordinal)
    {
        ["image/jpeg"] = "jpg",
        ["image/png"] = "png",
        ["image/webp"] = "webp"
    };

    // The extension of every kind of file the store keeps: the pictures, and the MP3s the Spanish is read into.
    private static readonly Dictionary<string, string> StoredExtensions = new(Extensions, StringComparer.Ordinal)
    {
        ["audio/mpeg"] = "mp3"
    };

    // The bytes each kind of file starts with, so a file is what its content type says it is.
    private static readonly byte[] JpegSignature = [0xFF, 0xD8, 0xFF];
    private static readonly byte[] PngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    private static readonly byte[] RiffSignature = "RIFF"u8.ToArray();
    private static readonly byte[] WebpSignature = "WEBP"u8.ToArray();

    // A new name for a picture of this kind: random, so a picture is only found through its card, and a replaced
    // picture gets a new URL (browsers keep the old one).
    public static string NewName(string contentType)
    {
        return $"{Guid.NewGuid():N}.{StoredExtensions[contentType]}";
    }

    // A name for a file from its content, for one kept under the same name everywhere (a built-in card's picture, or
    // the audio of a phrase): the same content always gets the same name, and changed content a new name and so a
    // new URL.
    public static string ContentName(ReadOnlySpan<byte> data, string contentType)
    {
        return $"{Convert.ToHexStringLower(SHA256.HashData(data))[..32]}.{StoredExtensions[contentType]}";
    }

    // Whether a name is one NewName or ContentName made, so a store only touches its own files.
    public static bool IsName(string name)
    {
        return Name().IsMatch(name);
    }

    // The content type of a file by a name NewName or ContentName made, from its extension.
    public static string ContentTypeOf(string name)
    {
        var extension = Path.GetExtension(name).TrimStart('.');
        return StoredExtensions.Single(item => item.Value == extension).Key;
    }

    // Checks and decodes a picture sent as base64 (see TryValidate). The content type comes back as a store keeps it (lowercase), and
    // the error says what's wrong in words for the user.
    public static bool TryDecode(
        string? contentType,
        string? base64,
        out ReadOnlyMemory<byte> data,
        out string normalizedContentType,
        out string error)
    {
        data = default;
        normalizedContentType = (contentType ?? string.Empty).Trim().ToLowerInvariant();
        error = string.Empty;

        if (!Extensions.ContainsKey(normalizedContentType))
        {
            error = "The picture must be a JPEG, PNG or WebP.";
            return false;
        }

        if (string.IsNullOrEmpty(base64))
        {
            error = "The picture is empty.";
            return false;
        }

        if (base64.Length > MaxBase64Length)
        {
            error = TooBigMessage;
            return false;
        }

        var buffer = new byte[base64.Length * 3 / 4];
        if (!Convert.TryFromBase64String(base64, buffer, out var length) || length == 0)
        {
            error = "The picture isn't valid base64.";
            return false;
        }

        if (!TryValidate(buffer.AsMemory(0, length), normalizedContentType, out _, out error))
        {
            return false;
        }

        data = buffer.AsMemory(0, length);
        return true;
    }

    // Checks a picture's bytes, however they came: that it's a kind a card can have, within the limit, and starts the
    // way that kind of file does. The content type comes back as a store keeps it (lowercase), and the error says
    // what's wrong in words for the user.
    public static bool TryValidate(
        ReadOnlyMemory<byte> data,
        string? contentType,
        out string normalizedContentType,
        out string error)
    {
        normalizedContentType = (contentType ?? string.Empty).Trim().ToLowerInvariant();
        error = string.Empty;

        if (!Extensions.ContainsKey(normalizedContentType))
        {
            error = "The picture must be a JPEG, PNG or WebP.";
            return false;
        }

        if (data.IsEmpty)
        {
            error = "The picture is empty.";
            return false;
        }

        if (data.Length > MaxBytes)
        {
            error = TooBigMessage;
            return false;
        }

        var bytes = data.Span;
        var matches = normalizedContentType switch
        {
            "image/jpeg" => bytes.StartsWith(JpegSignature),
            "image/png" => bytes.StartsWith(PngSignature),
            _ => bytes.StartsWith(RiffSignature) && bytes.Length >= 12 && bytes[8..12].SequenceEqual(WebpSignature)
        };
        if (!matches)
        {
            error = "The picture isn't the kind of image its content type says.";
            return false;
        }

        return true;
    }

    [GeneratedRegex(@"^[0-9a-f]{32}\.(jpg|png|webp|mp3)$")]
    private static partial Regex Name();
}
