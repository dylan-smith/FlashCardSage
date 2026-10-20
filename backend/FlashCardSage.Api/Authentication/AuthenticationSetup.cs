using System.Security.Claims;
using FlashCardSage.Api.OAuth;
using FlashCardSage.Api.Startup;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;

namespace FlashCardSage.Api.Authentication;

/// <remarks>
/// Every request carries a bearer token: a Google ID token from Google sign-in on the frontend, one of the tokens
/// <see cref="LocalTokenHandler"/> accepts, or, on /mcp only, an access token the API's OAuth server gave an MCP client
/// (see <see cref="OAuthAccessTokenHandler"/>). Whichever it is, the signed-in user gets the same claims: "sub" is the
/// identity prefixed with where it came from (e.g. "google:&lt;sub&gt;"), plus "name" and "email" when known.
/// </remarks>
public static class AuthenticationSetup
{
    public const string SubjectClaim = "sub";

    public const string NameClaim = "name";

    public const string EmailClaim = "email";

    // The authorization policy for the MCP endpoint.
    public const string McpPolicy = "Mcp";

    private const string SelectorScheme = "FlashCardSage";

    private const string GoogleScheme = "Google";

    private const string GoogleSubjectPrefix = "google:";

    public static IServiceCollection AddFlashCardSageAuthentication(this IServiceCollection services, IConfiguration configuration)
    {
        var googleClientId = configuration["Authentication:Google:ClientId"];
        var allowTestSignIn = configuration.GetValue<bool>("Authentication:AllowTestSignIn");
        var serviceToken = configuration["Authentication:ServiceToken"];
        var useGoogle = !string.IsNullOrWhiteSpace(googleClientId);

        StartupLog.Info(useGoogle
            ? "Authentication: Google sign-in enabled."
            : "Authentication: No Google client ID configured; Google sign-in is disabled.");

        if (allowTestSignIn)
        {
            StartupLog.Info("WARNING: Test sign-in is enabled. Anyone can sign in as any test user.");
        }

        if (!string.IsNullOrEmpty(serviceToken))
        {
            StartupLog.Info("Authentication: Service token enabled.");
        }

        services.AddOAuthServer(configuration);

        var authentication = services.AddAuthentication(SelectorScheme)
            // Picks the handler from the token, so each request is only checked by the one that can read it.
            .AddPolicyScheme(SelectorScheme, SelectorScheme, options => options.ForwardDefaultSelector = context =>
                ReadBearerToken(context.Request) switch
                {
                    { } token when OAuthTokens.IsAccessToken(token) => OAuthAccessTokenHandler.SchemeName,
                    { } token when useGoogle
                        && !token.StartsWith(LocalTokenHandler.TestTokenPrefix, StringComparison.Ordinal)
                        && !LocalTokenHandler.IsServiceToken(token, serviceToken) => GoogleScheme,
                    _ => LocalTokenHandler.SchemeName
                })
            .AddScheme<LocalTokenOptions, LocalTokenHandler>(LocalTokenHandler.SchemeName, options =>
            {
                options.AllowTestSignIn = allowTestSignIn;
                options.ServiceToken = serviceToken;
            })
            .AddScheme<AuthenticationSchemeOptions, OAuthAccessTokenHandler>(OAuthAccessTokenHandler.SchemeName, null);

        if (useGoogle)
        {
            authentication.AddJwtBearer(GoogleScheme, options =>
            {
                options.Authority = "https://accounts.google.com";
                options.MapInboundClaims = false;
                options.TokenValidationParameters.ValidAudience = googleClientId;
                options.TokenValidationParameters.ValidIssuers = ["accounts.google.com", "https://accounts.google.com"];
                options.Events = new JwtBearerEvents
                {
                    OnTokenValidated = context =>
                    {
                        var principal = context.Principal!;
                        var subject = principal.FindFirstValue(SubjectClaim);

                        if (string.IsNullOrEmpty(subject))
                        {
                            context.Fail("The Google token has no subject.");
                            return Task.CompletedTask;
                        }

                        context.Principal = new ClaimsPrincipal(CreateIdentity(
                            GoogleScheme,
                            GoogleSubjectPrefix + subject,
                            principal.FindFirstValue(NameClaim),
                            principal.FindFirstValue(EmailClaim)));
                        return Task.CompletedTask;
                    }
                };
            });
        }

        // Every endpoint needs a signed-in user unless it allows anonymous access, as /health does.
        // The MCP endpoint takes the OAuth server's access tokens, and test sign-in and the service token for local
        // development, E2E tests, previews and smoke tests, but not a Google ID token, which was issued to the frontend.
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
            .AddPolicy(McpPolicy, policy => policy
                .RequireAuthenticatedUser()
                .RequireAssertion(context => context.User.Identity?.AuthenticationType
                    is OAuthAccessTokenHandler.SchemeName or LocalTokenHandler.SchemeName));

        services.AddScoped<CurrentUser>();

        return services;
    }

    public static string? ReadBearerToken(HttpRequest request)
    {
        const string prefix = "Bearer ";
        var header = request.Headers.Authorization.ToString();

        return header.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && header.Length > prefix.Length
            ? header[prefix.Length..].Trim()
            : null;
    }

    public static ClaimsIdentity CreateIdentity(string authenticationType, string subject, string? name, string? email)
    {
        List<Claim> claims = [new(SubjectClaim, subject)];

        if (!string.IsNullOrEmpty(name))
        {
            claims.Add(new(NameClaim, name));
        }

        if (!string.IsNullOrEmpty(email))
        {
            claims.Add(new(EmailClaim, email));
        }

        return new ClaimsIdentity(claims, authenticationType, NameClaim, roleType: null);
    }
}
