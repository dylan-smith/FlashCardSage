namespace FlashCardSage.Api.Contracts;

// A generated picture, as base64, for the user to look at and then put on the card or not. Id is the picture's in
// the cache, which the next request for the same words sends as AfterId to get another.
public record CardImageResponse(int Id, string ContentType, string Data);
