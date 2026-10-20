using System.ComponentModel;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Mcp;

// What the MCP tools take and return, kept compact since every field costs the assistant's context. A card's tags are
// given by name, as the assistant puts them on cards by name.

// A card's words in each language, in order, its tags' names, and its picture's URL, or null when it has none.
public record CardSummary(
    int Id,
    IReadOnlyList<string> Spanish,
    IReadOnlyList<string> English,
    IReadOnlyList<string> Tags,
    string? ImageUrl)
{
    public static CardSummary From(FlashCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        return new CardSummary(card.Id, card.Spanish, card.English, TagNames(card), card.ImageUrl);
    }

    internal static List<string> TagNames(FlashCard card)
    {
        return [.. card.Tags.Select(tag => tag.Name).Order(TextRules.Comparer)];
    }
}

// A card as CardSummary has it, and the decks it's in.
public record CardDetail(
    int Id,
    IReadOnlyList<string> Spanish,
    IReadOnlyList<string> English,
    IReadOnlyList<string> Tags,
    string? ImageUrl,
    IReadOnlyList<DeckReference> Decks);

// A deck a card is in.
public record DeckReference(int Id, string Name);

// A page of cards, out of Total that matched, starting at Offset. HasMore says there's another page after it.
public record CardPage(IReadOnlyList<CardSummary> Cards, int Total, int Offset, bool HasMore);

// A card to add, as create_cards takes it.
public record CardInput(
    [property: Description("The card's Spanish words or phrases, 1 to 10, each up to 200 characters.")]
    IReadOnlyList<string>? Spanish,
    [property: Description("The card's English words or phrases, 1 to 10, each up to 200 characters.")]
    IReadOnlyList<string>? English,
    [property: Description("Names of tags to put on the card. A name the user hasn't used yet makes a new tag.")]
    IReadOnlyList<string>? Tags = null)
{
    public FlashCardRequest ToRequest()
    {
        return new FlashCardRequest { Spanish = [.. Spanish ?? []], English = [.. English ?? []], Tags = [.. Tags ?? []] };
    }

    public static CardInput From(FlashCardRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return new CardInput(request.Spanish, request.English, request.Tags);
    }
}

// The cards create_cards added, and the ones it left out because a word on them is already on one of the user's cards.
public record CardsCreated(IReadOnlyList<CardSummary> Created, IReadOnlyList<CardInput> Skipped);

// How many of the cards asked for were deleted. The rest were already gone.
public record CardsDeleted(int DeletedCount, int RequestedCount);

public record TagSummary(int Id, string Name, int CardCount);

public record DeckSummary(int Id, string Name, int CardCount);

// A deck and its cards' ids, in order. list_cards with the deck's id gives the cards themselves.
public record DeckDetail(int Id, string Name, IReadOnlyList<int> CardIds)
{
    public static DeckDetail From(Deck deck)
    {
        ArgumentNullException.ThrowIfNull(deck);
        return new DeckDetail(deck.Id, deck.Name, [.. deck.FlashCards.Select(card => card.Id).Order()]);
    }
}

// A card's practice score, out of 100, how many times it was answered with each outcome, and when it was last
// practiced, or null when it never was.
public record CardStats(
    int Id,
    IReadOnlyList<string> Spanish,
    IReadOnlyList<string> English,
    int Score,
    int GotIt,
    int WasClose,
    int Failed,
    DateTimeOffset? LastPracticedAt)
{
    public static CardStats From(FlashCardScore score)
    {
        ArgumentNullException.ThrowIfNull(score);
        return new CardStats(
            score.Id,
            score.Spanish,
            score.English,
            score.Score,
            score.GotIt,
            score.WasClose,
            score.Failed,
            score.LastPracticedAt);
    }
}

// The cards' scores, lowest first, a page of CardCount starting at Offset, and the total score of all of them out of
// the most they could score.
public record PracticeStats(
    int TotalScore,
    int MaximumScore,
    int CardCount,
    int Offset,
    bool HasMore,
    IReadOnlyList<CardStats> Cards);

// One go at a card in practice.
public record PracticeAttempt(PracticeOutcome Outcome, DateTimeOffset PracticedAt);

// A card's score and its practice attempts, newest first.
public record PracticeHistory(int CardId, int Score, int TotalAttempts, IReadOnlyList<PracticeAttempt> Attempts);

// How many cards, decks and tags the user has.
public record Counts(int Cards, int Decks, int Tags);
