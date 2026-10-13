namespace FlashCardSage.Api.Contracts;

// ShowPictures: whether cards' pictures are shown, in practice and where cards are managed. ShowSuggestions: whether
// the cards page suggests new cards. AutoTranslate: whether the side of a card the user types is translated into the
// other side, or they type both.
public record PreferencesResponse(bool ShowPictures, bool ShowSuggestions, bool AutoTranslate);
