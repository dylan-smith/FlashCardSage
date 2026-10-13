namespace FlashCardSage.Api.Contracts;

// The user's new deck, how many cards were copied into it, and how many were left out because the user already has a
// card with the same Spanish or English.
public record SystemDeckImportResponse(DeckResponse Deck, int ImportedCount, int SkippedCount);
