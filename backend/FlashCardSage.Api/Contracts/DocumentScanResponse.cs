using FlashCardSage.Api.Suggestions;

namespace FlashCardSage.Api.Contracts;

// The cards made for the words and phrases in a document, for the user to look over before adding them, and whether
// the document was too long to scan all of it, so only its start was scanned.
public record DocumentScanResponse(IReadOnlyList<CardSuggestion> Candidates, bool Truncated);
