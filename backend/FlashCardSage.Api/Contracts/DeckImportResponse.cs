namespace FlashCardSage.Api.Contracts;

// The user's new deck from a deck file, how many of its cards are new, how many they had already (which went in the
// deck as they are), how many were left out for repeating an earlier card in the file, and how many cards came without
// their generated picture, because it isn't on this site.
public record DeckImportResponse(
    DeckResponse Deck, int ImportedCount, int ExistingCount, int SkippedCount, int MissingPictureCount);
