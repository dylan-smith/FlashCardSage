using FlashCardSage.Api.Authentication;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Gives a new user a copy of the built-in Animals deck when their account is made (see CurrentUserMiddleware), so they
/// have cards to practice from their first visit. It's imported as any built-in deck is (see SystemDeckImporter), so
/// it's then like a deck they made. NewUsers:AddStarterDeck turns it on: production and previews have it, and
/// Development doesn't, so local and E2E tests' users start with nothing as before.
/// </summary>
public class StarterDeck(
    SystemDeckImporter importer,
    CurrentUser currentUser,
    IConfiguration configuration,
    ILogger<StarterDeck> logger)
{
    // The built-in deck's name in system-decks.json.
    public const string DeckName = "Animals";

    public bool Enabled => configuration.GetValue<bool>("NewUsers:AddStarterDeck");

    // Imports the deck for the user just made, as the request's current user.
    public async Task AddAsync(int userId, CancellationToken cancellationToken)
    {
        currentUser.UserId = userId;

        var deckId = await importer.SystemDecks()
            .Where(deck => deck.Name == DeckName)
            .Select(deck => (int?)deck.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (deckId is null)
        {
            // The built-in decks weren't added when the API started, which it tries again next time.
            logger.LogWarning("No starter deck for new user {UserId}: the system deck isn't there", userId);
            return;
        }

        var result = await importer.ImportDeckAsync(deckId.Value, cancellationToken);
        logger.LogInformation(
            "Gave new user {UserId} the starter deck {SystemDeckId}: {Result}", userId, deckId, result.GetType().Name);
    }
}
