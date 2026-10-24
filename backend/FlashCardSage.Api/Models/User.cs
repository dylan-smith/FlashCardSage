namespace FlashCardSage.Api.Models;

public class User
{
    /// <summary>
    /// The subject of the user that owns the built-in decks anyone can import (see SystemDeckSeeder). Every signed-in
    /// subject has a prefix, so nobody can sign in as it.
    /// </summary>
    public const string SystemSubject = "system";

    public int Id { get; set; }

    /// <summary>
    /// The signed-in identity, prefixed with where it came from, such as "google:&lt;sub&gt;".
    /// </summary>
    public string Subject { get; set; } = string.Empty;

    public string? Email { get; set; }

    public string? DisplayName { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>
    /// When the user last sent a request, to within <see cref="Authentication.UserAccounts.LastSeenPrecision"/>, or
    /// null if they haven't since it was recorded.
    /// </summary>
    public DateTimeOffset? LastSeenAt { get; set; }

    // The user's preferences (see PreferencesController), all on for a new user.
    public bool ShowPictures { get; set; } = true;

    public bool ShowSuggestions { get; set; } = true;

    public bool AutoTranslate { get; set; } = true;

    // Whether the Cards page shows the getting started guide. On for a new user; the users there were before it was
    // added had it turned off (see the 0018 script), since they'd found their way around already.
    public bool ShowGettingStarted { get; set; } = true;
}
