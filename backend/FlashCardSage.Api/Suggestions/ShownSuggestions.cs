using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Suggestions;

// What a page has already shown of its suggestions, which it sends so asking for more gives different ones.
public static class ShownSuggestions
{
    // How many, the newest, the model is told not to suggest again, so the request stays short.
    public const int MaxCount = 50;

    // The newest MaxCount of them trimmed, each once, leaving out any that are blank or longer than maxLength.
    public static List<string> From(IEnumerable<string>? shown, int maxLength)
    {
        return (shown ?? [])
            .Select(TextRules.Clean)
            .Where(text => text.Length > 0 && text.Length <= maxLength)
            .Distinct(TextRules.Comparer)
            .TakeLast(MaxCount)
            .ToList();
    }
}
