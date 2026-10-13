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
}
