using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The apps the signed-in user has connected through the OAuth server, newest first. Disconnecting one deletes its
/// tokens and any code it hasn't redeemed yet, so it has to ask the user again.
/// </summary>
[ApiController]
[Route("api/oauth/connections")]
public class OAuthConnectionsController(OAuthConnectionService connectionService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<OAuthConnectionResponse>>> GetAll(CancellationToken cancellationToken)
    {
        var grants = await connectionService.GetAllAsync(cancellationToken);

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
        return await connectionService.DeleteAsync(id, cancellationToken) ? NoContent() : NotFound();
    }
}
