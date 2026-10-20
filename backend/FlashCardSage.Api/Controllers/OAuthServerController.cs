using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.OAuth;
using FlashCardSage.Api.Startup;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The OAuth 2.1 endpoints MCP clients sign users in with (see OAuthServerMetadata). Nobody is signed in on them: the
/// user signs in on the frontend's consent page, which /oauth/authorize sends them to. Errors are OAuth's, not problem
/// responses, except for the 503 when the server isn't set up.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("oauth")]
public class OAuthServerController(
    OAuthServerOptions options,
    OAuthClientRegistry clients,
    OAuthAuthorizationService authorizations,
    OAuthTokenService tokens) : ApiControllerBase
{
    // Always a redirect: to the consent page, or with an error to the app or, when the app or its redirect URI isn't
    // known, to the frontend.
    [HttpGet("authorize")]
    public async Task<IActionResult> Authorize([FromQuery] OAuthAuthorizeRequest request, CancellationToken cancellationToken)
    {
        return options.IsConfigured
            ? Redirect(await authorizations.BeginAsync(request, cancellationToken))
            : NotConfigured();
    }

    [HttpPost("token")]
    [Consumes("application/x-www-form-urlencoded")]
    [EnableCors(CorsSetup.PublicPolicy)]
    public async Task<IActionResult> Token(CancellationToken cancellationToken)
    {
        if (!options.IsConfigured)
        {
            return NotConfigured();
        }

        var form = await Request.ReadFormAsync(cancellationToken);
        string? Value(string name)
        {
            var value = form[name].ToString();
            return string.IsNullOrEmpty(value) ? null : value;
        }

        await tokens.CleanupIfDueAsync(cancellationToken);

        var result = Value("grant_type") switch
        {
            "authorization_code" => await tokens.ExchangeCodeAsync(
                Value("code"),
                Value("client_id"),
                Value("redirect_uri"),
                Value("code_verifier"),
                Value("resource"),
                cancellationToken),
            "refresh_token" => await tokens.RefreshAsync(
                Value("refresh_token"),
                Value("client_id"),
                Value("scope"),
                Value("resource"),
                cancellationToken),
            _ => OAuthTokenResult.Refused(
                OAuthErrors.UnsupportedGrantType, "grant_type must be authorization_code or refresh_token.")
        };

        return result.Tokens is not null ? new NoStoreJsonResult(result.Tokens) : OAuthErrors.Result(result.Error!);
    }

    [HttpPost("register")]
    [EnableCors(CorsSetup.PublicPolicy)]
    public async Task<IActionResult> Register(
        [FromBody] OAuthClientRegistrationRequest request, CancellationToken cancellationToken)
    {
        if (!options.IsConfigured)
        {
            return NotConfigured();
        }

        var registration = await clients.RegisterAsync(request, cancellationToken);
        return registration.Client is { } client
            ? new NoStoreJsonResult(
                new OAuthClientRegistrationResponse(
                    client.ClientId,
                    client.CreatedAt.ToUnixTimeSeconds(),
                    client.Name,
                    client.RedirectUris,
                    "none",
                    ["authorization_code", "refresh_token"],
                    ["code"]),
                StatusCodes.Status201Created)
            : OAuthErrors.Result(registration.Error!);
    }

    private ObjectResult NotConfigured()
    {
        return ServiceUnavailableProblem("Signing in apps isn't set up here.");
    }
}
