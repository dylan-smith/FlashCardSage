using FlashCardSage.Api.Data;
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
        var taken = TakenWords.From(cards);

        foreach (var suggestion in suggested)
        {
            // The answer is read from JSON, so a side can be missing despite the type.
            var card = new CardSuggestion(TextRules.Clean(suggestion.Spanish), TextRules.Clean(suggestion.English));
            if (!Fits(card.Spanish) || !Fits(card.English)
                || taken.Contains(Language.Spanish, card.Spanish) || taken.Contains(Language.English, card.English))
            {
                continue;
            }

            taken.Add(Language.Spanish, card.Spanish);
            taken.Add(Language.English, card.English);
            yield return card;
        }
    }

    private static bool Fits(string side)
    {
        return side.Length is > 0 and <= FlashCard.MaxWordLength;
    }
}
