using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// The signed-in user's account (see MeController).
/// </summary>
public class AccountService(
    FlashCardDbContext dbContext,
    CurrentUser currentUser,
    IImageStore imageStore,
    ILogger<AccountService> logger)
{
    // Deletes the signed-in user and everything that's theirs: their cards, tags, decks, practice results, cached
    // suggestions and the apps they've connected. Translations, generated pictures and spoken audio belong to no
    // user, so they stay. The same sign-in gets a new, empty account on its next request.
    public async Task DeleteAsync()
    {
        var userId = currentUser.UserId;
        var user = await dbContext.Users.SingleAsync(item => item.Id == userId);

        // The database would delete most of these along with the user, but not a tag's or a deck's links to cards
        // (see FlashCardDbContext), and the in-memory database deletes nothing by itself. So everything is loaded, and
        // EF deletes it in an order the foreign keys allow, in one save.
        var cards = await dbContext.FlashCards.WithWordsAndTags().ToListAsync();
        var grants = await dbContext.OAuthGrants.ToListAsync();
        var grantIds = grants.Select(grant => grant.Id).ToList();

        dbContext.RemoveRange(await dbContext.PracticeResults.ToListAsync());
        dbContext.RemoveRange(await dbContext.SentencePracticeResults.ToListAsync());
        dbContext.RemoveRange(await dbContext.Decks.WithCards().ToListAsync());
        dbContext.RemoveRange(cards);
        dbContext.RemoveRange(await dbContext.Tags.ToListAsync());
        dbContext.RemoveRange(await dbContext.CardSuggestions.ToListAsync());
        dbContext.RemoveRange(await dbContext.TagSuggestions.ToListAsync());
        // Tokens and sign-ins in progress have no query filter, so they're found by their grant and user.
        dbContext.RemoveRange(
            await dbContext.OAuthTokens.Where(token => grantIds.Contains(token.GrantId)).ToListAsync());
        dbContext.RemoveRange(
            await dbContext.OAuthAuthorizationRequests.Where(request => request.UserId == userId).ToListAsync());
        dbContext.RemoveRange(grants);
        dbContext.Users.Remove(user);
        await dbContext.SaveChangesAsync();

        await imageStore.TryDeleteCardPicturesAsync(
            dbContext, cards.Select(card => card.ImageUrl), logger, CancellationToken.None);

        logger.LogInformation("Deleted user {UserId}'s account, with {Count} flash cards", userId, cards.Count);
    }
}
