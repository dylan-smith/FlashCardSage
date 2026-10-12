namespace FlashCardSage.Api.Models;

// One go at a card in practice mode. It belongs to the card's owner, so it's only ever reached through its card.
public class PracticeResult
{
    public int Id { get; set; }

    public int FlashCardId { get; set; }

    public FlashCard FlashCard { get; set; } = null!;

    public PracticeOutcome Outcome { get; set; }

    public DateTimeOffset PracticedAt { get; set; }
}
