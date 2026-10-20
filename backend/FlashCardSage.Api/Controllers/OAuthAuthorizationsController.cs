using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The frontend's consent page: an app's sign-in waiting for the signed-in user, who approves or denies it. Either way
/// the page sends the browser on to the URL it's given. A sign-in that's unknown, expired or already answered is a 404.
/// </summary>
[ApiController]
[Route("api/oauth/authorizations")]
public class OAuthAuthorizationsController(OAuthAuthorizationService authorizations) : ControllerBase
{
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<OAuthAuthorizationRequestResponse>> Get(Guid id, CancellationToken cancellationToken)
    {
        var request = await authorizations.GetPendingAsync(id, cancellationToken);

        return request is null ? NotFound() : Ok(ToResponse(request));
    }

    [HttpPost("{id:guid}/approve")]
    public async Task<ActionResult<OAuthRedirectResponse>> Approve(Guid id, CancellationToken cancellationToken)
    {
        var redirectUrl = await authorizations.ApproveAsync(id, cancellationToken);

        return redirectUrl is null ? NotFound() : Ok(new OAuthRedirectResponse(redirectUrl));
    }

    [HttpPost("{id:guid}/deny")]
    public async Task<ActionResult<OAuthRedirectResponse>> Deny(Guid id, CancellationToken cancellationToken)
    {
        var redirectUrl = await authorizations.DenyAsync(id, cancellationToken);

        return redirectUrl is null ? NotFound() : Ok(new OAuthRedirectResponse(redirectUrl));
    }

    private static OAuthAuthorizationRequestResponse ToResponse(OAuthAuthorizationRequest request)
    {
        var redirect = new Uri(request.RedirectUri);

        return new OAuthAuthorizationRequestResponse(
            request.Id,
            request.Client.Name,
            OAuthClientRegistry.ClientHost(request.Client),
            !request.Client.IsMetadataDocument,
            // An app's own scheme, such as "cursor:", has no host.
            string.IsNullOrEmpty(redirect.Host) ? redirect.Scheme : redirect.Host,
            request.Scope.Split(' ', StringSplitOptions.RemoveEmptyEntries),
            request.ExpiresAt);
    }
}
