namespace FlashCardSage.Api.Contracts;

// A card's words in each language, in order. LastPracticedAt is null for a card that's never been practiced, and
// ImageUrl for a card without a picture.
public record FlashCardScore(
    int Id,
    IReadOnlyList<string> Spanish,
    IReadOnlyList<string> English,
    int Score,
    DateTimeOffset? LastPracticedAt,
    string? ImageUrl);

// Every card's score, lowest first, and the total out of the most the cards could score.
public record FlashCardScoresResponse(int Total, int Maximum, IReadOnlyList<FlashCardScore> Cards);
