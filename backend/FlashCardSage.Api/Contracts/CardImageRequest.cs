namespace FlashCardSage.Api.Contracts;

// A picture to put on a card: one the API generated, by its ID in the cache, which the card then shares with every
// other card that has it, or else one of the user's own, as base64.
public class CardImageRequest
{
    public int? GeneratedImageId { get; set; }

    public string? ContentType { get; set; }

    public string? Data { get; set; }
}
