using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions.Foundry;

// How cards are written in the requests to the chat model.
public static class PromptText
{
    // A card as Spanish = English, with a side's words for the same meaning separated by /.
    public static string Card(FlashCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        return Card(card.Spanish, card.English);
    }

    public static string Card(IEnumerable<string> spanish, IEnumerable<string> english)
    {
        return $"{string.Join(" / ", spanish)} = {string.Join(" / ", english)}";
    }

    // A card as id: Spanish = English, so the model can say which cards it used.
    public static string CardWithId(FlashCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        return $"{card.Id}: {Card(card)}";
    }

    // A card as Spanish = English [tags], with no brackets when it has no tags.
    public static string CardWithTags(FlashCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        return card.Tags.Count == 0
            ? Card(card)
            : $"{Card(card)} [{string.Join(", ", card.Tags.Select(tag => tag.Name))}]";
    }
}
