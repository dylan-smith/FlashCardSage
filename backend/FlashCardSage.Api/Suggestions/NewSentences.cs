using System.Globalization;
using System.Text;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// Picks the sentences a model wrote that the user can practice.
public static class NewSentences
{
    // The sentences trimmed, leaving out any with a blank or too-long side, or a Spanish that repeats an earlier one
    // (ignoring case). Each one's cards are the ones the model gave that are in scope, then any other card in scope
    // whose Spanish is in the sentence as it is on the card, since the model tends to give only the cards it built the
    // sentence around and doesn't see every card in scope. Each is kept once and no more than a result keeps. A
    // sentence the model gave no cards in scope for is left out, since it wasn't written to practice any of them.
    public static IEnumerable<PracticeSentence> From(
        IEnumerable<PracticeSentence> generated, IReadOnlyList<FlashCard> scope)
    {
        var scopeIds = scope.Select(card => card.Id).ToHashSet();
        var seen = new HashSet<string>(TextRules.Comparer);

        foreach (var sentence in generated)
        {
            // The answer is read from JSON, so a side or the ids can be missing despite the type.
            var spanish = TextRules.Clean(sentence.Spanish);
            var english = TextRules.Clean(sentence.English);
            var given = (sentence.CardIds ?? []).Where(scopeIds.Contains).ToList();
            if (!Fits(spanish) || !Fits(english) || given.Count == 0 || !seen.Add(spanish))
            {
                continue;
            }

            var words = Words(spanish);
            var found = scope.Where(card => card.Spanish.Any(phrase => Contains(words, Words(phrase))))
                .Select(card => card.Id);
            List<int> cardIds = [.. given.Concat(found).Distinct().Take(SentencePracticeResult.MaxCards)];
            yield return new PracticeSentence(spanish, english, cardIds);
        }
    }

    private static bool Fits(string side)
    {
        return side.Length is > 0 and <= SentencePracticeResult.MaxSentenceLength;
    }

    // The text's words in lower case without accents, so "Por favor" is found in "¿Cierras la puerta, por favor?" and
    // "está" in "Esta". A note in brackets on a card, as in "cerrar (algo)", isn't one of its words.
    private static List<string> Words(string text)
    {
        var words = new List<string>();
        var word = new StringBuilder();
        var bracketed = 0;
        foreach (var letter in text.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(letter) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }
            if (bracketed == 0 && char.IsLetterOrDigit(letter))
            {
                word.Append(char.ToLowerInvariant(letter));
                continue;
            }

            if (letter == '(')
            {
                bracketed++;
            }
            else if (letter == ')')
            {
                bracketed = Math.Max(0, bracketed - 1);
            }
            if (word.Length > 0)
            {
                words.Add(word.ToString());
                word.Clear();
            }
        }
        if (word.Length > 0)
        {
            words.Add(word.ToString());
        }
        return words;
    }

    // Whether the phrase's words are in the sentence's, together and in order.
    private static bool Contains(List<string> sentence, List<string> phrase)
    {
        if (phrase.Count == 0)
        {
            return false;
        }
        for (var start = 0; start + phrase.Count <= sentence.Count; start++)
        {
            if (sentence.Skip(start).Take(phrase.Count).SequenceEqual(phrase))
            {
                return true;
            }
        }
        return false;
    }
}
