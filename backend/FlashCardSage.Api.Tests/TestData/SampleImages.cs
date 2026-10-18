namespace FlashCardSage.Api.Tests.TestData;

internal static class SampleImages
{
    // The start of each kind of file, followed by a few bytes of nothing in particular.
    public static readonly byte[] Jpeg = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
    public static readonly byte[] Png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];
    public static readonly byte[] Webp = [.. "RIFF"u8.ToArray(), 0x24, 0x00, 0x00, 0x00, .. "WEBP"u8.ToArray(), 0x56, 0x50];
}
