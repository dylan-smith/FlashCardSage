using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Services;

/// <summary>
/// What became of a change to the user's cards (see FlashCardService), for the controller to turn into a response.
/// </summary>
public abstract record CardResult
{
    private CardResult()
    {
    }

    // The card was made, or had already been made by an earlier try of the same request.
    public sealed record Created(FlashCard Card) : CardResult;

    public sealed record Updated(FlashCard Card) : CardResult;

    // The cards that were added, and how many were left out because their words were taken.
    public sealed record CreatedMany(IReadOnlyList<FlashCard> Cards, int SkippedCount) : CardResult;

    // A word that's already on another of the user's cards.
    public sealed record Duplicate(FlashCardWord Word) : CardResult;

    // The request's problems as (field, message) pairs, in the order they were found.
    public sealed record Invalid(IReadOnlyList<KeyValuePair<string, string>> Errors) : CardResult;

    public sealed record NotFound : CardResult;

    // A card saved meanwhile failed the unique index on its words, so none of the cards were added.
    public sealed record Clash : CardResult;
}
