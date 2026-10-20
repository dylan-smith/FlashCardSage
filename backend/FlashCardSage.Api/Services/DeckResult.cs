using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Services;

/// <summary>
/// What became of a change to the user's decks (see DeckService), for the caller to turn into a response.
/// </summary>
public abstract record DeckResult
{
    private DeckResult()
    {
    }

    // The deck was made or changed, with all its cards.
    public sealed record Saved(Deck Deck) : DeckResult;

    public sealed record Deleted : DeckResult;

    public sealed record NotFound : DeckResult;

    // The request's problems as (field, message) pairs, in the order they were found.
    public sealed record Invalid(IReadOnlyList<KeyValuePair<string, string>> Errors) : DeckResult;
}
