using System.Text.RegularExpressions;

namespace FlashCardSage.Api.Images;

// The pictures a card can have: the kinds of image, how big one can be, and the names they're kept under.
public static partial class CardImage
{
    // Plenty for a compressed JPEG from the generator, which is around a hundred kilobytes.
    public const int MaxBytes = 2 * 1024 * 1024;

    public const string TooBigMessage = "The picture can be at most 2 MB.";

    // The most characters the base64 of a picture within the limit can take.
    private const int MaxBase64Length = (MaxBytes + 2) / 3 * 4;

    // Each kind's file extension.
    private static readonly Dictionary<string, string> Extensions = new(StringComparer.Ordinal)
    {
        ["image/jpeg"] = "jpg",
        ["image/png"] = "png",
        ["image/webp"] = "webp"
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
        return $"{Guid.NewGuid():N}.{Extensions[contentType]}";
    }

    // Whether a name is one NewName made, so a store only touches its own files.
    public static bool IsName(string name)
    {
        return Name().IsMatch(name);
    }

    // The content type of a picture by a name NewName made, from its extension.
    public static string ContentTypeOf(string name)
    {
        var extension = Path.GetExtension(name).TrimStart('.');
        return Extensions.Single(item => item.Value == extension).Key;
    }

    // Checks and decodes a picture sent as base64. The content type comes back as a store keeps it (lowercase), and
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

        if (length > MaxBytes)
        {
            error = TooBigMessage;
            return false;
        }

        var bytes = buffer.AsSpan(0, length);
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

        data = buffer.AsMemory(0, length);
        return true;
    }

    [GeneratedRegex(@"^[0-9a-f]{32}\.(jpg|png|webp)$")]
    private static partial Regex Name();
}
