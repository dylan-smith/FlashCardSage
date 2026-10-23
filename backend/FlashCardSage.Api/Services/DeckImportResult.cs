using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Services;

/// <summary>
/// What became of importing a deck file (see DeckSharingService), for the controller to turn into a response.
/// </summary>
public abstract record DeckImportResult
{
    private DeckImportResult()
    {
    }

    // The user's new deck, with how many of its cards are new, how many the user had already (which went in the deck
    // as they are), how many were left out for repeating an earlier card in the file, and how many generated pictures
    // the file named that aren't in the cache, whose cards came without them.
    public sealed record Imported(
        Deck Deck, int ImportedCount, int ExistingCount, int SkippedCount, int MissingPictureCount) : DeckImportResult;

    // What's wrong with the file, in words for the user.
    public sealed record Invalid(string Message) : DeckImportResult;

    // A card or deck saved meanwhile failed a unique index, so nothing was imported.
    public sealed record Clash : DeckImportResult;
}
