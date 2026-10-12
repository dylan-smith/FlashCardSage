namespace FlashCardSage.Api.Contracts;

public record FlashCardScore(int Id, string Spanish, string English, int Score);

// Every card's score, lowest first, and the total out of the most the cards could score.
public record FlashCardScoresResponse(int Total, int Maximum, IReadOnlyList<FlashCardScore> Cards);
