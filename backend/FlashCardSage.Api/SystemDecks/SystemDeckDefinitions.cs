using System.Text.Json;

namespace FlashCardSage.Api.SystemDecks;

// Like a user's card, a built-in card can have more than one word in each language, in order.
public record SystemCardDefinition(
    IReadOnlyList<string> Spanish, IReadOnlyList<string> English, IReadOnlyList<string> Tags);

public record SystemDeckDefinition(string Name, IReadOnlyList<SystemCardDefinition> Cards);

/// <summary>
/// The built-in decks, as written in system-decks.json, which is built into the API.
/// </summary>
public static class SystemDeckDefinitions
{
    private const string ResourceName = "FlashCardSage.Api.SystemDecks.system-decks.json";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static IReadOnlyList<SystemDeckDefinition> Load()
    {
        using var stream = typeof(SystemDeckDefinitions).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"The {ResourceName} resource is missing.");

        return JsonSerializer.Deserialize<SystemDecksFile>(stream, JsonOptions)?.Decks
            ?? throw new InvalidOperationException($"The {ResourceName} resource has no decks.");
    }

    private sealed record SystemDecksFile(IReadOnlyList<SystemDeckDefinition> Decks);
}
