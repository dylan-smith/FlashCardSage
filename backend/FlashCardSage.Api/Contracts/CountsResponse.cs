namespace FlashCardSage.Api.Contracts;

// How many cards, decks and tags the user has.
public record CountsResponse(int Cards, int Decks, int Tags);
