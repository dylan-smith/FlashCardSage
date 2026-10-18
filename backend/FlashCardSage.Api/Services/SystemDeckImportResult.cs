using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Services;

/// <summary>
/// What became of importing a built-in deck or one of its cards (see SystemDeckImporter), for the controller to turn
/// into a response.
/// </summary>
public abstract record SystemDeckImportResult
{
    private SystemDeckImportResult()
    {
    }

    // The user's copy of the deck, and how many of its cards were left out because the user has their words.
    public sealed record DeckImported(Deck Deck, int SkippedCount) : SystemDeckImportResult;

    // The user's copy of the card, and the deck it went into, which DeckCreated says was made for it.
    public sealed record CardImported(Deck Deck, bool DeckCreated, FlashCard Card) : SystemDeckImportResult;

    public sealed record NotFound : SystemDeckImportResult;

    // Every one of the deck's cards has a word the user already has.
    public sealed record NothingToImport : SystemDeckImportResult;

    // The card has a word the user already has.
    public sealed record CardTaken : SystemDeckImportResult;

    // A card or deck saved meanwhile failed a unique index, so nothing was imported.
    public sealed record Clash : SystemDeckImportResult;
}
