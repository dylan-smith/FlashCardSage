namespace FlashCardSage.Api.Models;

// What the suggestion model last suggested for a prompt made from the user's cards, kept so the same prompt isn't paid
// for again (see SuggestionCache). The prompt is made from the user's own cards, so unlike a cached translation or
// picture, it belongs to the user. It's never returned itself.
public interface ICachedSuggestions<T> : IUserOwned
{
    int Id { get; }

    // The SHA-256, as lowercase hex, of the prompt (see SuggestionCache.PromptHash).
    string PromptHash { get; set; }

    // As the model suggested them, before the ones the user has are left out.
    List<T> Suggestions { get; set; }

    // When they were suggested, so the oldest can be removed.
    DateTimeOffset CreatedAt { get; set; }
}
