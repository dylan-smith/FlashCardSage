namespace FlashCardSage.Api.Contracts.Admin;

// How the people using the app use it, for the admin overview. Only people count (see UsageSnapshot.IsPerson), so the
// built-in decks' cards and the service user's aren't in it. Active users were last seen in the period, and new ones
// signed up in it. CardsBySource has every source, with "Unknown" for cards made before it was recorded. The cached
// translations and pictures, and the OAuth server's apps, belong to nobody, so they're all counted.
public record AdminOverviewResponse(
    int Users,
    int ActiveUsersLast7Days,
    int ActiveUsersLast30Days,
    int NewUsersLast30Days,
    int Cards,
    int Decks,
    int Tags,
    int PracticeResults,
    int PracticeResultsLast7Days,
    int PracticeResultsLast30Days,
    IReadOnlyDictionary<string, int> CardsBySource,
    int CachedTranslations,
    int GeneratedImages,
    int OAuthClients,
    int ConnectedApps);
