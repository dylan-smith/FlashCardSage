namespace FlashCardSage.Api.Models;

// The names of the new tags the suggestion model last suggested for a request (see CachedTagSuggester).
public class CachedTagSuggestions : ICachedSuggestions<string>
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public string PromptHash { get; set; } = string.Empty;

    public List<string> Suggestions { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }
}
