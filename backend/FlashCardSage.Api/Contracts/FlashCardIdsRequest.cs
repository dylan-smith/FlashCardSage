namespace FlashCardSage.Api.Contracts;

// Some of the user's cards, such as the ones picked on the cards page to delete together.
public class FlashCardIdsRequest
{
    public List<int> FlashCardIds { get; set; } = [];
}
