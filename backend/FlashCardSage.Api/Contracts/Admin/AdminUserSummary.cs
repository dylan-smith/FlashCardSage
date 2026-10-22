namespace FlashCardSage.Api.Contracts.Admin;

// One person using the app, for the admin pages. Provider is where they signed in from, the part of their subject
// before the colon (such as "google"). LastSeenAt and LastPracticedAt are null when they haven't been seen since it
// was recorded, or haven't practiced.
public record AdminUserSummary(
    int Id,
    string Subject,
    string Provider,
    string? DisplayName,
    string? Email,
    DateTimeOffset CreatedAt,
    DateTimeOffset? LastSeenAt,
    int Cards,
    int Decks,
    int Tags,
    int PracticeResults,
    DateTimeOffset? LastPracticedAt,
    int ConnectedApps);
