namespace FlashCardSage.Api.Observability;

// Records nothing, for when PostHog isn't set up.
public sealed class NullAiUsage : IAiUsage
{
    public void Record(AiGeneration generation)
    {
    }
}
