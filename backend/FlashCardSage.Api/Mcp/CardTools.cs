using System.ComponentModel;
using System.Globalization;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace FlashCardSage.Api.Mcp;

/// <summary>
/// The MCP tools that read, add, change and delete the user's cards, through FlashCardService as the cards page does.
/// </summary>
/// <remarks>
/// Made for each call from the request's services, so the query filters keep it to the signed-in user's cards. A list
/// the assistant leaves out is taken as empty, so it gets the same message as one it sends empty.
/// </remarks>
[McpServerToolType]
public class CardTools(FlashCardDbContext dbContext, FlashCardService flashCards)
{
    public const int DefaultPageSize = 50;

    public const int MaxPageSize = 200;

    // The most cards create_cards adds at once, the same as a document scan finds.
    public const int MaxBatchSize = 100;

    [McpServerTool(Name = "list_cards", Title = "List flash cards", ReadOnly = true, OpenWorld = false)]
    [Description("Lists the user's flash cards in the order they were added, a page at a time, optionally only those in a deck, with a tag, or matching a search.")]
    public async Task<CardPage> ListCardsAsync(
        [Description("Text to find in a card's Spanish, English or tag names, ignoring case and accents.")] string? search = null,
        [Description("Only cards with this tag.")] int? tagId = null,
        [Description("Only cards in this deck.")] int? deckId = null,
        [Description("How many cards to return, 1 to 200. Defaults to 50.")] int? limit = null,
        [Description("How many matching cards to skip, for the next page.")] int? offset = null)
    {
        if (!await dbContext.SelectionExistsAsync(new PracticeSelection { DeckId = deckId, TagId = tagId }))
        {
            throw ToolErrors.Error(deckId is null ? ToolErrors.TagNotFound : ToolErrors.DeckNotFound);
        }

        var query = dbContext.FlashCards.AsNoTracking();
        if (deckId is { } deck)
        {
            query = query.Where(card => card.Decks.Any(item => item.Id == deck));
        }

        if (tagId is { } tag)
        {
            query = query.Where(card => card.Tags.Any(item => item.Id == tag));
        }

        // Searched here rather than in SQL, as the in-memory database can't ignore accents. A person's cards already
        // come back in one go on the cards page.
        var cards = await query.WithWordsAndTags().OrderBy(card => card.Id).ToListAsync();
        var term = search?.Trim() ?? string.Empty;
        if (term.Length > 0)
        {
            cards = [.. cards.Where(card => Matches(card, term))];
        }

        var skip = Math.Max(offset ?? 0, 0);
        var take = Math.Clamp(limit ?? DefaultPageSize, 1, MaxPageSize);
        var page = cards.Skip(skip).Take(take).Select(CardSummary.From).ToList();

        return new CardPage(page, cards.Count, skip, skip + page.Count < cards.Count);
    }

    [McpServerTool(Name = "get_card", Title = "Get a flash card", ReadOnly = true, OpenWorld = false)]
    [Description("Gets one of the user's flash cards, with its tags and the decks it's in.")]
    public async Task<CardDetail> GetCardAsync([Description("The card's id.")] int id)
    {
        var card = await dbContext.FlashCards
            .AsNoTracking()
            .WithWordsAndTags()
            .FirstOrDefaultAsync(item => item.Id == id)
            ?? throw ToolErrors.Error(ToolErrors.CardNotFound);
        var decks = await dbContext.Decks
            .AsNoTracking()
            .Where(deck => deck.FlashCards.Any(item => item.Id == id))
            .OrderBy(deck => deck.Name)
            .Select(deck => new DeckReference(deck.Id, deck.Name))
            .ToListAsync();

        return new CardDetail(card.Id, card.Spanish, card.English, CardSummary.TagNames(card), card.ImageUrl, decks);
    }

    [McpServerTool(Name = "create_card", Title = "Add a flash card", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Adds a flash card with one meaning. Fails, naming the card, if one of its words is already on another of the user's cards.")]
    public async Task<CardSummary> CreateCardAsync(
        [Description("The card's Spanish words or phrases, 1 to 10, each up to 200 characters.")] string[]? spanish,
        [Description("The card's English words or phrases, 1 to 10, each up to 200 characters.")] string[]? english,
        [Description("Names of tags to put on the card. A name the user hasn't used yet makes a new tag.")] string[]? tags = null)
    {
        var result = await flashCards.CreateAsync(
            new FlashCardRequest { Spanish = [.. spanish ?? []], English = [.. english ?? []], Tags = [.. tags ?? []] });

        return result is CardResult.Created(var card) ? CardSummary.From(card) : throw ToolErrors.For(result);
    }

    [McpServerTool(Name = "create_cards", Title = "Add flash cards", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Adds up to 100 flash cards at once. A card with a word that's already on one of the user's cards, or on an earlier card in the list, is skipped and returned as skipped rather than failing the rest.")]
    public async Task<CardsCreated> CreateCardsAsync(
        [Description("The cards to add, 1 to 100.")] CardInput[]? cards)
    {
        if (cards is not { Length: > 0 and <= MaxBatchSize })
        {
            throw ToolErrors.Error($"Give between 1 and {MaxBatchSize} cards to add at once.");
        }

        var result = await flashCards.CreateManyAsync([.. cards.Select(card => card.ToRequest())]);

        return result is CardResult.CreatedMany created
            ? new CardsCreated(
                [.. created.Cards.Select(CardSummary.From)], [.. created.Skipped.Select(CardInput.From)])
            : throw ToolErrors.For(result);
    }

    [McpServerTool(Name = "update_card", Title = "Change a flash card", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Changes a flash card's words or tags. Each list given replaces the card's list; one left out stays as it is. An empty tags list removes all its tags.")]
    public async Task<CardSummary> UpdateCardAsync(
        [Description("The card's id.")] int id,
        [Description("The card's new Spanish words or phrases, 1 to 10.")] string[]? spanish = null,
        [Description("The card's new English words or phrases, 1 to 10.")] string[]? english = null,
        [Description("The names of the card's tags. A name the user hasn't used yet makes a new tag.")] string[]? tags = null)
    {
        var card = await dbContext.FlashCards
            .AsNoTracking()
            .WithWordsAndTags()
            .FirstOrDefaultAsync(item => item.Id == id)
            ?? throw ToolErrors.Error(ToolErrors.CardNotFound);

        var result = await flashCards.UpdateAsync(id, new FlashCardRequest
        {
            Spanish = [.. spanish ?? card.Spanish],
            English = [.. english ?? card.English],
            Tags = [.. tags ?? card.Tags.Select(tag => tag.Name)]
        });

        return result is CardResult.Updated(var updated) ? CardSummary.From(updated) : throw ToolErrors.For(result);
    }

    [McpServerTool(Name = "delete_cards", Title = "Delete flash cards", Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Deletes flash cards, with their pictures and practice history. Ids of cards that are already gone are skipped.")]
    public async Task<CardsDeleted> DeleteCardsAsync([Description("The cards' ids.")] int[]? ids)
    {
        var requested = (ids ?? []).Distinct().ToList();

        return requested.Count == 0
            ? throw ToolErrors.Error("Give the ids of the cards to delete.")
            : new CardsDeleted(await flashCards.DeleteManyAsync(requested), requested.Count);
    }

    // Whether the card's words or tag names hold the text, ignoring case and accents (so "nino" finds "niño").
    private static bool Matches(FlashCard card, string term)
    {
        return card.Spanish.Concat(card.English).Concat(card.Tags.Select(tag => tag.Name)).Any(text =>
            CultureInfo.InvariantCulture.CompareInfo.IndexOf(
                text, term, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace) >= 0);
    }
}
