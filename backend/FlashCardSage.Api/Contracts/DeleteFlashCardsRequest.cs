namespace FlashCardSage.Api.Contracts;

// Cards to delete at once, such as the ones picked on a deck's page. A card that's already gone is left out.
public class DeleteFlashCardsRequest
{
    public List<int> Ids { get; set; } = [];
}
