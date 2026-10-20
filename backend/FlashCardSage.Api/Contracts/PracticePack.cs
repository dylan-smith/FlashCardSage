using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Contracts;

// A card as the device keeps it to practice offline: its words in each language, in order, its score, when it was
// last practiced (null if never), its picture's URL (null without one) and the ids of its tags, in order.
public record PracticePackCard(
    int Id,
    IReadOnlyList<string> Spanish,
    IReadOnlyList<string> English,
    int Score,
    DateTimeOffset? LastPracticedAt,
    string? ImageUrl,
    IReadOnlyList<int> TagIds);

// Everything the device needs to practice offline: all the user's cards, in card order, and their decks and tags, by
// name, to practice one of them.
public record PracticePack(
    IReadOnlyList<PracticePackCard> Cards, IReadOnlyList<DeckResponse> Decks, IReadOnlyList<Tag> Tags);
