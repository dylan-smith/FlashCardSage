using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// The card to practice next, and the side the user is shown first.
public record PracticeCard(int Id, string Spanish, string English, PracticeSide Side);
