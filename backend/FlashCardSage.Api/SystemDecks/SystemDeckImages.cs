using System.Text.Json;

namespace FlashCardSage.Api.SystemDecks;

// A built-in card's picture: the card, by the first Spanish word it has in system-decks.json, and the picture's file.
public record SystemCardImage(string Spanish, string Path);

/// <summary>
/// The built-in cards' pictures, which scripts/Generate-SystemDeckImages.ps1 makes into SystemDecks/images and lists
/// in its images.json. They're copied next to the API, which puts them on the cards (see SystemDeckImageSync).
/// </summary>
public static class SystemDeckImages
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string Directory { get; } = Path.Join(AppContext.BaseDirectory, "SystemDecks", "images");

    // The cards' pictures in the folder. A card the image model refused has no file, so it isn't one of them.
    public static IReadOnlyList<SystemCardImage> Load(string directory)
    {
        var manifestPath = Path.Join(directory, "images.json");
        if (!File.Exists(manifestPath))
        {
            return [];
        }

        using var stream = File.OpenRead(manifestPath);
        var entries = JsonSerializer.Deserialize<Dictionary<string, ImageEntry>>(stream, JsonOptions) ?? [];
        return
        [
            .. entries
                .Where(entry => !string.IsNullOrEmpty(entry.Value.File))
                .Select(entry => new SystemCardImage(entry.Key, Path.Join(directory, entry.Value.File)))
        ];
    }

    private sealed record ImageEntry(string? File);
}
