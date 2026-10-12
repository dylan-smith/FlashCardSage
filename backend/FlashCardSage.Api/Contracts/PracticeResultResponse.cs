namespace FlashCardSage.Api.Contracts;

// The card's score after the answer just recorded, and when it was given.
public record PracticeResultResponse(int Score, DateTimeOffset PracticedAt);
