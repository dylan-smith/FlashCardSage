namespace FlashCardSage.Api.Contracts;

// The translation to fill in, and other meanings the user can pick instead (empty for a phrase).
public record TranslationResponse(string Translation, IReadOnlyList<string> Alternatives);
