namespace FlashCardSage.Api.Contracts;

// The card to practice after the one just answered, and how much the answer raised or lowered that card's score.
// Next is null when there are no cards left to practice in the deck or tag being practiced.
public record PracticeResultResponse(PracticeCard? Next, int ScoreChange);
