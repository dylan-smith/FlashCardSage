namespace FlashCardSage.Api.Contracts;

// A generated picture, as base64, for the user to look at and then put on the card or not.
public record CardImageResponse(string ContentType, string Data);
