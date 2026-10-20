using System.Diagnostics;
using System.Globalization;
using FlashCardSage.Api.Authentication;
using Microsoft.Extensions.Options;
using PostHog;

namespace FlashCardSage.Api.Observability;

// Sends each AI model call to PostHog as an $ai_generation event, with the prompt and the answer, for its AI
// observability (https://posthog.com/docs/ai-observability/manual-capture). The PostHog client queues events and sends
// them in batches in the background, so recording one doesn't wait on PostHog.
//
// The event is the signed-in user's, by their user ID. Each request is a trace of its own, with the request's
// OpenTelemetry trace ID, which is also its operation ID in Application Insights.
public sealed class PostHogAiUsage(
    IPostHogClient posthog,
    CurrentUser currentUser,
    IOptions<AiUsageOptions> options,
    ILogger<PostHogAiUsage> logger) : IAiUsage
{
    public const string EventName = "$ai_generation";

    public void Record(AiGeneration generation)
    {
        // Only requests make model calls, and only signed-in ones.
        if (currentUser.UserId is not { } userId)
        {
            return;
        }

        try
        {
            posthog.Capture(
                userId.ToString(CultureInfo.InvariantCulture),
                EventName,
                Properties(generation, options.Value.Environment, Activity.Current?.TraceId.ToHexString()));
        }
        // Observability never fails the request that made the call.
        catch (Exception ex)
        {
            logger.LogWarning(ex, "The {Feature} call couldn't be sent to PostHog", generation.Feature);
        }
    }

    // The event's properties. Anything not known is left out rather than sent as null.
    public static Dictionary<string, object> Properties(AiGeneration generation, string environment, string? traceId)
    {
        ArgumentNullException.ThrowIfNull(generation);
        var properties = new Dictionary<string, object>
        {
            ["$ai_trace_id"] = traceId ?? Guid.NewGuid().ToString("N"),
            ["$ai_span_name"] = generation.Feature,
            ["$ai_model"] = generation.Model,
            ["$ai_provider"] = "azure",
            ["$ai_base_url"] = generation.BaseUrl,
            ["$ai_input"] = generation.Input.Select(Message).ToList(),
            ["$ai_latency"] = generation.Latency.TotalSeconds,
            ["$ai_is_error"] = generation.Error is not null,
            ["feature"] = generation.Feature
        };

        if (!string.IsNullOrEmpty(environment))
        {
            properties["environment"] = environment;
        }

        if (generation.Output is { } output)
        {
            properties["$ai_output_choices"] = new[] { Message(new AiMessage("assistant", output)) };
        }

        Add(properties, "$ai_input_tokens", generation.InputTokens);
        Add(properties, "$ai_cache_read_input_tokens", generation.CachedInputTokens);
        Add(properties, "$ai_output_tokens", generation.OutputTokens);
        Add(properties, "reasoning_tokens", generation.ReasoningTokens);
        Add(properties, "$ai_max_tokens", generation.MaxTokens);
        Add(properties, "image_bytes", generation.ImageBytes);
        Add(properties, "$ai_http_status", generation.HttpStatus);
        Add(properties, "finish_reason", generation.FinishReason);
        Add(properties, "$ai_error", generation.Error);
        return properties;
    }

    private static Dictionary<string, string> Message(AiMessage message)
    {
        return new() { ["role"] = message.Role, ["content"] = message.Content };
    }

    private static void Add(Dictionary<string, object> properties, string name, object? value)
    {
        if (value is not null)
        {
            properties[name] = value;
        }
    }
}
