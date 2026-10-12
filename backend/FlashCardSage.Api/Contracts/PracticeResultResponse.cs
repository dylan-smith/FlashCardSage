namespace FlashCardSage.Api.Contracts;

// The card to practice after the one just answered.
public record PracticeResultResponse(PracticeCard Next);
