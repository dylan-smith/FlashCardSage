using FlashCardSage.Api.Contracts;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.OAuth;

// An OAuth error code and what went wrong, for the app's developer rather than the user.
public record OAuthError(string Code, string Description);

/// <summary>
/// The OAuth error codes the server uses, and the responses that carry them: JSON the RFCs describe, never cached.
/// </summary>
public static class OAuthErrors
{
    public const string InvalidRequest = "invalid_request";

    public const string InvalidClient = "invalid_client";

    public const string InvalidGrant = "invalid_grant";

    public const string UnsupportedGrantType = "unsupported_grant_type";

    public const string UnsupportedResponseType = "unsupported_response_type";

    public const string InvalidScope = "invalid_scope";

    // RFC 8707: the resource isn't one this server issues tokens for.
    public const string InvalidTarget = "invalid_target";

    public const string AccessDenied = "access_denied";

    // RFC 7591's registration errors.
    public const string InvalidRedirectUri = "invalid_redirect_uri";

    public const string InvalidClientMetadata = "invalid_client_metadata";

    public static ActionResult Result(OAuthError error, int statusCode = StatusCodes.Status400BadRequest)
    {
        ArgumentNullException.ThrowIfNull(error);

        return new NoStoreJsonResult(new OAuthErrorResponse(error.Code, error.Description), statusCode);
    }
}

// JSON with Cache-Control: no-store, as every token endpoint response must have (RFC 6749 section 5.1).
public sealed class NoStoreJsonResult : JsonResult
{
    public NoStoreJsonResult(object value, int statusCode = StatusCodes.Status200OK)
        : base(value)
    {
        StatusCode = statusCode;
    }

    public override Task ExecuteResultAsync(ActionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);

        context.HttpContext.Response.Headers.CacheControl = "no-store";
        context.HttpContext.Response.Headers.Pragma = "no-cache";
        return base.ExecuteResultAsync(context);
    }
}
