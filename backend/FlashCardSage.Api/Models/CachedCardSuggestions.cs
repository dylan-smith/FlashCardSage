using FlashCardSage.Api.Suggestions;

namespace FlashCardSage.Api.Models;

// The cards the suggestion model last suggested for a request (see CachedCardSuggester).
public class CachedCardSuggestions : ICachedSuggestions<CardSuggestion>
{
    public int Id { get; set; }

    public int UserId { get; set; }

    public string PromptHash { get; set; } = string.Empty;

    public List<CardSuggestion> Suggestions { get; set; } = [];

    public DateTimeOffset CreatedAt { get; set; }
}
