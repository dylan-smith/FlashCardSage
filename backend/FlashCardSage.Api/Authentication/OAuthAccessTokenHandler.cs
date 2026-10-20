using System.Security.Claims;
using System.Text.Encodings.Web;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.OAuth;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Authentication;

/// <summary>
/// Signs in with the access tokens the API's OAuth server gives MCP clients ("fcs_at_..."), as the user who connected
/// the app. They only work on /mcp: everything else, including the endpoints that manage connected apps, needs the user
/// themselves.
/// </summary>
public class OAuthAccessTokenHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    FlashCardDbContext dbContext,
    TimeProvider timeProvider) : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "McpAccessToken";

    public const string McpPath = "/mcp";

    // How out of date a grant's LastUsedAt may be, so a busy app doesn't write on every request.
    private static readonly TimeSpan LastUsedPrecision = TimeSpan.FromMinutes(5);

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (AuthenticationSetup.ReadBearerToken(Request) is not { } token || !OAuthTokens.IsAccessToken(token))
        {
            return AuthenticateResult.NoResult();
        }

        if (!Request.Path.StartsWithSegments(McpPath, StringComparison.OrdinalIgnoreCase))
        {
            return AuthenticateResult.Fail("An MCP access token only works on /mcp.");
        }

        var tokenHash = OAuthTokens.Hash(token);
        var now = timeProvider.GetUtcNow();

        // Nobody is signed in yet, so the grant is found past its filter.
        var found = await (
                from accessToken in dbContext.OAuthTokens
                where accessToken.TokenHash == tokenHash
                    && accessToken.Kind == OAuthTokenKind.Access
                    && accessToken.ExpiresAt > now
                join grant in dbContext.OAuthGrants.IgnoreQueryFilters() on accessToken.GrantId equals grant.Id
                join user in dbContext.Users on grant.UserId equals user.Id
                select new { Grant = grant, user.Subject, user.DisplayName, user.Email })
            .FirstOrDefaultAsync(Context.RequestAborted);

        if (found is null)
        {
            return AuthenticateResult.Fail("The access token isn't valid.");
        }

        if (found.Grant.LastUsedAt is not { } lastUsedAt || now - lastUsedAt >= LastUsedPrecision)
        {
            found.Grant.LastUsedAt = now;
            await dbContext.SaveChangesAsync(Context.RequestAborted);
        }

        var principal = new ClaimsPrincipal(AuthenticationSetup.CreateIdentity(
            Scheme.Name, found.Subject, found.DisplayName, found.Email));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name));
    }
}
