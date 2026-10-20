namespace FlashCardSage.Api.Startup;

public static class CorsSetup
{
    // The policy for endpoints anyone's browser may call (see EnableCorsAttribute).
    public const string PublicPolicy = "Public";

    // Lets the frontend's origins, from Cors:AllowedOrigins, call the API. With none, no cross-origin call is allowed.
    public static IServiceCollection AddFlashCardSageCors(this IServiceCollection services, IConfiguration configuration)
    {
        var allowedOrigins = configuration
            .GetSection("Cors:AllowedOrigins")
            .Get<string[]>() ?? [];

        StartupLog.Info(
            allowedOrigins.Length == 0
                ? "CORS: No allowed origins configured."
                : $"CORS allowed origins: {string.Join(", ", allowedOrigins)}");

        services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                if (allowedOrigins.Length == 0)
                {
                    return;
                }

                // The frontend's telemetry adds a traceparent header, which makes every request preflighted, so let
                // browsers cache the preflight response.
                policy.WithOrigins(allowedOrigins)
                    .AllowAnyHeader()
                    .AllowAnyMethod()
                    .SetPreflightMaxAge(TimeSpan.FromMinutes(10));
            });

            // The OAuth metadata, token and registration endpoints, which MCP clients that run in a browser (such as
            // MCP Inspector) call from any origin. They take no cookies, so there's nothing for another site to borrow.
            options.AddPolicy(PublicPolicy, policy => policy
                .AllowAnyOrigin()
                .WithMethods("GET", "POST")
                .AllowAnyHeader()
                .SetPreflightMaxAge(TimeSpan.FromMinutes(10)));
        });

        return services;
    }
}
