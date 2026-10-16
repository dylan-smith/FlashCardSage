using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// The user's deck the built-in card was copied into, which is new unless they already had a deck with the built-in
// deck's name, and the copy itself.
public record SystemDeckCardImportResponse(DeckResponse Deck, bool DeckCreated, FlashCard Card);
