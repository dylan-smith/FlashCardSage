using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// Picks the cards a model suggested that the user can add.
public static class NewCards
{
    // The suggestions trimmed, leaving out any with a blank or too-long side, and any that would be a duplicate of one
    // of the user's cards or an earlier suggestion (either side matching any of a card's words, ignoring case, as when
    // a card is saved).
    public static IEnumerable<CardSuggestion> From(IEnumerable<CardSuggestion> suggested, IEnumerable<FlashCard> cards)
    {
        var spanish = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var english = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var card in cards)
        {
            spanish.UnionWith(card.Spanish);
            english.UnionWith(card.English);
        }

        foreach (var suggestion in suggested)
        {
            // The answer is read from JSON, so a side can be missing despite the type.
            var card = new CardSuggestion(
                (suggestion.Spanish ?? string.Empty).Trim(), (suggestion.English ?? string.Empty).Trim());
            if (!Fits(card.Spanish) || !Fits(card.English)
                || spanish.Contains(card.Spanish) || english.Contains(card.English))
            {
                continue;
            }

            spanish.Add(card.Spanish);
            english.Add(card.English);
            yield return card;
        }
    }

    private static bool Fits(string side)
    {
        return side.Length is > 0 and <= FlashCard.MaxWordLength;
    }
}
