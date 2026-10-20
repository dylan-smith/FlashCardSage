using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The apps the signed-in user has connected through the OAuth server, newest first. Disconnecting one deletes its
/// tokens and any code it hasn't redeemed yet, so it has to ask the user again.
/// </summary>
[ApiController]
[Route("api/oauth/connections")]
public class OAuthConnectionsController(
    FlashCardDbContext dbContext,
    ILogger<OAuthConnectionsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<OAuthConnectionResponse>>> GetAll(CancellationToken cancellationToken)
    {
        var grants = await dbContext.OAuthGrants
            .AsNoTracking()
            .Include(grant => grant.Client)
            .OrderByDescending(grant => grant.CreatedAt)
            .ThenByDescending(grant => grant.Id)
            .ToListAsync(cancellationToken);

        return Ok(grants.Select(grant => new OAuthConnectionResponse(
            grant.Id,
            grant.Client.Name,
            OAuthClientRegistry.ClientHost(grant.Client),
            !grant.Client.IsMetadataDocument,
            grant.Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries),
            grant.CreatedAt,
            grant.LastUsedAt)));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        // Filtered to the user, so another user's is a 404.
        var grant = await dbContext.OAuthGrants.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (grant is null)
        {
            return NotFound();
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

        return NoContent();
    }
}
