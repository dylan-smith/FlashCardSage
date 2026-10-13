namespace FlashCardSage.Api.Contracts;

// The card to practice after the one just answered, and how much the answer raised or lowered that card's score.
public record PracticeResultResponse(PracticeCard Next, int ScoreChange);
