using FlashCardSage.Api.Startup;

namespace FlashCardSage.Api.OAuth;

public static class OAuthSetup
{
    // The OAuth server MCP clients sign in with. It's off, answering 503, until Api:BaseUrl and Frontend:BaseUrl are set.
    public static OAuthServerOptions AddOAuthServer(this IServiceCollection services, IConfiguration configuration)
    {
        var options = OAuthServerOptions.FromConfiguration(configuration);

        StartupLog.Info(options.IsConfigured
            ? $"OAuth: issuer {options.Issuer}, consent page on {options.Frontend}."
            : "OAuth: disabled; set Api:BaseUrl and Frontend:BaseUrl to turn it on.");

        services.AddSingleton(options);
        services.AddScoped<OAuthClientRegistry>();
        services.AddScoped<OAuthAuthorizationService>();
        services.AddScoped<OAuthTokenService>();
        services.AddScoped<OAuthConnectionService>();
        // An app's metadata document is fetched while the user waits to sign in, and it must be at that exact URL.
        services.AddHttpClient<ClientMetadataFetcher>(client => client.Timeout = TimeSpan.FromSeconds(5))
            .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false });

        return options;
    }
}
