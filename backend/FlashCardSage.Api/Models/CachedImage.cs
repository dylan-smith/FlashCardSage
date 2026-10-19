namespace FlashCardSage.Api.Models;

// A picture the API got from the image generator, kept so the same words aren't paid for again while there are
// pictures of them the user hasn't seen. Like a cached translation it belongs to no user: every user's pictures go
// through it (see CachedImageGenerator). It's never returned itself.
public class CachedImage
{
    public const int PromptHashLength = 64;

    public int Id { get; set; }

    // The SHA-256, as lowercase hex, of the lowercased prompt (see CachedImageGenerator.PromptHash).
    public string PromptHash { get; set; } = string.Empty;

    // The picture in the image store, which every card given it shares, so it's never removed.
    public string ImageUrl { get; set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; set; }
}
