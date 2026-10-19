namespace FlashCardSage.Api.Contracts;

// How many of the answers sent were recorded. The rest were already recorded, or were for cards that are gone.
public record PracticeResultsSyncResponse(int Accepted);
