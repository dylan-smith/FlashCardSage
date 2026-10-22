namespace FlashCardSage.Api.Contracts.Admin;

// One of a person's cards, for the admin user page: its words, the names of its tags and decks, how it was added
// ("Unknown" when that wasn't recorded) and how it's done in practice, as FlashCardScore has it. CreatedAt is null for
// a card made before it was recorded.
public record AdminCardSummary(
    int Id,
    IReadOnlyList<string> Spanish,
    IReadOnlyList<string> English,
    IReadOnlyList<string> Tags,
    IReadOnlyList<string> Decks,
    string? ImageUrl,
    DateTimeOffset? CreatedAt,
    string Source,
    int Score,
    int GotIt,
    int WasClose,
    int Failed,
    DateTimeOffset? LastPracticedAt);
