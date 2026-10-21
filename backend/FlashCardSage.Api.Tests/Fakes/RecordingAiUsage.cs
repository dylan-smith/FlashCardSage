using FlashCardSage.Api.Observability;

namespace FlashCardSage.Api.Tests.Fakes;

// Keeps every AI model call recorded.
internal sealed class RecordingAiUsage : IAiUsage
{
    public List<AiGeneration> Generations { get; } = [];

    public void Record(AiGeneration generation)
    {
        Generations.Add(generation);
    }
}
