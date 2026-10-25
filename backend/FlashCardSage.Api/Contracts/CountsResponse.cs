namespace FlashCardSage.Api.Contracts;

// How many cards, decks and tags the user has, and how many answers they've given in practice.
public record CountsResponse(int Cards, int Decks, int Tags, int Practiced);
