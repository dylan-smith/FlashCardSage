namespace FlashCardSage.Api.Contracts;

// The user's new deck, made from a built-in deck or imported words, how many cards were put in it, and how many were
// left out because the user already has a card with the same Spanish or English.
public record DeckImportResponse(DeckResponse Deck, int ImportedCount, int SkippedCount);
