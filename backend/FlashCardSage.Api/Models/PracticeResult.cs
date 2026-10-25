namespace FlashCardSage.Api.Models;

// One go at a card in practice mode. It belongs to the card's owner, so it's only ever reached through its card.
public class PracticeResult
{
    public int Id { get; set; }

    public int FlashCardId { get; set; }

    public FlashCard FlashCard { get; set; } = null!;

    public PracticeOutcome Outcome { get; set; }

    public DateTimeOffset PracticedAt { get; set; }

    // The id the device gave the answer when it was practiced offline, so sending it again doesn't record it twice.
    // Null for results recorded before practice worked offline.
    public Guid? ClientId { get; set; }

    // Whether the card was practiced in listening mode, heard rather than read. Null for results recorded before it
    // was, including answers a device practiced then and sent later.
    public bool? Listening { get; set; }
}
