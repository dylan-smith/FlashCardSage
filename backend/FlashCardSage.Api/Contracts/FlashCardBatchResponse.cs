using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// The cards that were added, and how many were left out because the user already has a card with the same Spanish or
// English, or one earlier in the list does.
public record FlashCardBatchResponse(IReadOnlyList<FlashCard> Cards, int SkippedCount);
