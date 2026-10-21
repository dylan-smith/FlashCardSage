namespace FlashCardSage.Api.Observability;

// Records the AI model calls the API makes, for PostHog's AI observability (see PostHogAiUsage).
public interface IAiUsage
{
    // Records a call that got an answer, or failed to. It never throws and never waits, so it can't slow down or fail
    // the request that made the call.
    void Record(AiGeneration generation);
}

// One call to an AI model: what it was for and asked, and what came back.
public sealed record AiGeneration(
    string Feature, string Model, string BaseUrl, IReadOnlyList<AiMessage> Input, TimeSpan Latency)
{
    public string? Output { get; init; }

    public int? InputTokens { get; init; }

    public int? CachedInputTokens { get; init; }

    // Including the reasoning tokens.
    public int? OutputTokens { get; init; }

    public int? ReasoningTokens { get; init; }

    public int? MaxTokens { get; init; }

    public string? FinishReason { get; init; }

    // The size of a generated picture.
    public int? ImageBytes { get; init; }

    public int? HttpStatus { get; init; }

    // Why the call failed, or why its answer couldn't be used. Null when it succeeded.
    public string? Error { get; init; }
}

public sealed record AiMessage(string Role, string Content);
