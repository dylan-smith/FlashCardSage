using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// Picks the sentences a model wrote that the user can practice.
public static class NewSentences
{
    // The sentences trimmed, leaving out any with a blank or too-long side, or a Spanish that repeats an earlier one
    // (ignoring case), with each one's card ids cut to the cards in scope, each once and no more than a result keeps.
    // A sentence left with no cards is left out, since it doesn't practice any of the user's.
    public static IEnumerable<PracticeSentence> From(IEnumerable<PracticeSentence> generated, IEnumerable<int> scopeIds)
    {
        var scope = scopeIds.ToHashSet();
        var seen = new HashSet<string>(TextRules.Comparer);

        foreach (var sentence in generated)
        {
            // The answer is read from JSON, so a side or the ids can be missing despite the type.
            var spanish = TextRules.Clean(sentence.Spanish);
            var english = TextRules.Clean(sentence.English);
            List<int> cardIds = [.. (sentence.CardIds ?? []).Distinct().Where(scope.Contains)
                .Take(SentencePracticeResult.MaxCards)];
            if (!Fits(spanish) || !Fits(english) || cardIds.Count == 0 || !seen.Add(spanish))
            {
                continue;
            }

            yield return new PracticeSentence(spanish, english, cardIds);
        }
    }

    private static bool Fits(string side)
    {
        return side.Length is > 0 and <= SentencePracticeResult.MaxSentenceLength;
    }
}
