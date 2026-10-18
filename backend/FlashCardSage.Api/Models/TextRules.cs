namespace FlashCardSage.Api.Models;

// How the words and names users type are tidied and compared. They're compared ignoring case, as the database's
// unique indexes do, and in memory, since the in-memory database used in development can't ignore case in a query.
public static class TextRules
{
    // For sets and lookups of words or names.
    public static StringComparer Comparer => StringComparer.OrdinalIgnoreCase;

    public static bool SameText(string? a, string? b)
    {
        return string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
    }

    // The text trimmed, or empty when there's none. A list read from JSON can hold nulls despite its type.
    public static string Clean(string? text)
    {
        return (text ?? string.Empty).Trim();
    }

    // The words trimmed, leaving out blanks and, with dedupe, repeats (the first of them is kept).
    public static List<string> CleanWords(IEnumerable<string?> words, bool dedupe)
    {
        ArgumentNullException.ThrowIfNull(words);

        var cleaned = words.Select(Clean).Where(word => word.Length > 0);
        return (dedupe ? cleaned.Distinct(Comparer) : cleaned).ToList();
    }
}
