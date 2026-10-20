using FlashCardSage.Api.Contracts;
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

    // The cards that were added, and the requests left out because their words were taken, in the order given.
    public sealed record CreatedMany(IReadOnlyList<FlashCard> Cards, IReadOnlyList<FlashCardRequest> Skipped)
        : CardResult
    {
        public int SkippedCount => Skipped.Count;
    }

    // A word that's already on another of the user's cards.
    public sealed record Duplicate(FlashCardWord Word) : CardResult
    {
        // What to tell the user. A word with more than one translation belongs on one card, so the user is pointed at
        // that card.
        public static string DuplicateMessage(Language language, string word)
        {
            return $"You already have a flash card with the {language} \"{word}\". Add this translation to that card instead.";
        }

        public string Message => DuplicateMessage(Word.Language, Word.Text);
    }

    // The request's problems as (field, message) pairs, in the order they were found.
    public sealed record Invalid(IReadOnlyList<KeyValuePair<string, string>> Errors) : CardResult;

    public sealed record NotFound : CardResult;

    // A card saved meanwhile failed the unique index on its words, so none of the cards were added.
    public sealed record Clash : CardResult;
}
