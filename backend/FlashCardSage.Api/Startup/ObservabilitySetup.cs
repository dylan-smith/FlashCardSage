using FlashCardSage.Api.Observability;
using PostHog.Config;

namespace FlashCardSage.Api.Startup;

public static class ObservabilitySetup
{
    // Sends every AI model call to PostHog's AI observability when there's a PostHog:ProjectToken setting, and
    // otherwise records nothing.
    public static IServiceCollection AddAiUsageTracking(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<AiUsageOptions>().BindConfiguration(AiUsageOptions.SectionName);
        var settings = configuration.GetSection(AiUsageOptions.SectionName).Get<AiUsageOptions>() ?? new AiUsageOptions();
        if (!settings.IsAvailable)
        {
            StartupLog.Info("No PostHog project token found. AI usage won't be sent to PostHog.");
            services.AddSingleton<IAiUsage, NullAiUsage>();
            return services;
        }

        StartupLog.Info("Sending AI usage to PostHog.");
        services.AddPostHog(posthog => posthog.PostConfigure(options =>
        {
            options.ProjectToken = settings.ProjectToken;
            // An empty host (e.g. no POSTHOG_HOST variable in CI) keeps the SDK's, which is PostHog's US cloud.
            if (!string.IsNullOrWhiteSpace(settings.HostUrl))
            {
                options.HostUrl = new Uri(settings.HostUrl);
            }
        }));
        services.AddScoped<IAiUsage, PostHogAiUsage>();
        return services;
    }
}
