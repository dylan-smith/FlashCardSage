using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.OAuth;

/// <summary>
/// The apps the signed-in user has connected through the OAuth server, for OAuthConnectionsController. Grants are
/// filtered to the user, so another user's is never found.
/// </summary>
public class OAuthConnectionService(FlashCardDbContext dbContext, ILogger<OAuthConnectionService> logger)
{
    // The user's grants with their apps, newest first.
    public async Task<List<OAuthGrant>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        return await dbContext.OAuthGrants
            .AsNoTracking()
            .Include(grant => grant.Client)
            .OrderByDescending(grant => grant.CreatedAt)
            .ThenByDescending(grant => grant.Id)
            .ToListAsync(cancellationToken);
    }

    // Disconnects the app: deletes the grant, its tokens and any code it hasn't redeemed yet, so it has to ask the
    // user again. False when the user has no grant with this id.
    public async Task<bool> DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var grant = await dbContext.OAuthGrants.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (grant is null)
        {
            return false;
        }

        // The database would cascade to the tokens, but the in-memory one doesn't.
        dbContext.OAuthTokens.RemoveRange(
            await dbContext.OAuthTokens.Where(token => token.GrantId == grant.Id).ToListAsync(cancellationToken));
        dbContext.OAuthAuthorizationRequests.RemoveRange(
            await dbContext.OAuthAuthorizationRequests
                .Where(request => request.UserId == grant.UserId
                    && request.OAuthClientId == grant.OAuthClientId
                    && request.RedeemedAt == null)
                .ToListAsync(cancellationToken));
        dbContext.OAuthGrants.Remove(grant);
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation("User {UserId} disconnected OAuth client {OAuthClientId}", grant.UserId, grant.OAuthClientId);

        return true;
    }
}
