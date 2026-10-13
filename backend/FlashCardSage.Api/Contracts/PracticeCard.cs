using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// The card to practice next, with its words in each language, and the side the user is shown first. Every word on
// the side shown is the same answer, so the user is shown them all. ImageUrl is null for a card without a picture.
public record PracticeCard(
    int Id, IReadOnlyList<string> Spanish, IReadOnlyList<string> English, PracticeSide Side, string? ImageUrl);
