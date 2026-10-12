namespace FlashCardSage.Api.Contracts;

// LastPracticedAt is null for a card that's never been practiced.
public record FlashCardScore(int Id, string Spanish, string English, int Score, DateTimeOffset? LastPracticedAt);

// Every card's score, lowest first, and the total out of the most the cards could score.
public record FlashCardScoresResponse(int Total, int Maximum, IReadOnlyList<FlashCardScore> Cards);
