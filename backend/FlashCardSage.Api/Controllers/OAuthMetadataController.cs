using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.OAuth;
using FlashCardSage.Api.Startup;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The metadata MCP clients discover the OAuth server from, at the well-known URLs RFC 8414 and RFC 9728 give them. The
/// protected resource metadata is served both at the root and with the MCP endpoint's path after it, as clients try
/// either. These are the only place the documents are served: the MCP SDK's authentication handler, which points
/// a 401 from /mcp at the second URL, is told to leave them to this (see AuthenticationSetup).
/// </summary>
[ApiController]
[AllowAnonymous]
[EnableCors(CorsSetup.PublicPolicy)]
[Route(".well-known")]
public class OAuthMetadataController(OAuthServerOptions options) : ApiControllerBase
{
    [HttpGet("oauth-authorization-server")]
    public ActionResult<OAuthAuthorizationServerMetadata> AuthorizationServer()
    {
        return options.IsConfigured
            ? Ok(OAuthServerMetadata.AuthorizationServer(options))
            : NotConfigured();
    }

    [HttpGet("oauth-protected-resource")]
    [HttpGet("oauth-protected-resource/mcp")]
    public ActionResult<OAuthProtectedResourceMetadata> ProtectedResource()
    {
        return options.IsConfigured
            ? Ok(OAuthServerMetadata.ProtectedResource(options))
            : NotConfigured();
    }

    private ObjectResult NotConfigured()
    {
        return ServiceUnavailableProblem("Signing in apps isn't set up here.");
    }
}
