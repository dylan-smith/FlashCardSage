namespace FlashCardSage.Api.Observability;

// PostHog settings, from the PostHog configuration section. Every AI model call is sent to PostHog's AI observability
// when there's a project token, and nothing is sent without one, e.g. in local development and the tests.
public class AiUsageOptions
{
    public const string SectionName = "PostHog";

    // The PostHog project's token (phc_...), which can only send events, so it isn't a secret.
    public string ProjectToken { get; set; } = string.Empty;

    // PostHog's ingestion host: https://us.i.posthog.com, or https://eu.i.posthog.com for an EU project.
    public string HostUrl { get; set; } = "https://us.i.posthog.com";

    // Which deployment sent the event, e.g. production or pr-123, so the previews' events can be told apart.
    public string Environment { get; set; } = string.Empty;

    public bool IsAvailable => !string.IsNullOrWhiteSpace(ProjectToken);
}
