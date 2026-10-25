namespace FlashCardSage.Api.Contracts.Admin;

// How the people using the app use it, for the admin overview. Only people count (see UsageSnapshot.IsPerson), so the
// built-in decks' cards and the service user's aren't in it. Active users were last seen in the period, and new ones
// signed up in it. The listening numbers count the results practiced in listening mode in the last 30 days, and the
// people who practiced that way then. CardsBySource has every source, with "Unknown" for cards made before it was
// recorded. The cached translations, pictures and audio, and the OAuth server's apps, belong to nobody, so they're all
// counted.
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
    int ListeningPracticeResultsLast30Days,
    int ListeningUsersLast30Days,
    IReadOnlyDictionary<string, int> CardsBySource,
    int CachedTranslations,
    int GeneratedImages,
    int GeneratedAudio,
    int OAuthClients,
    int ConnectedApps);
