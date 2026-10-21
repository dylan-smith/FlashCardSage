using System.ComponentModel;
using FlashCardSage.Api.Services;
using ModelContextProtocol.Server;

namespace FlashCardSage.Api.Mcp;

/// <summary>
/// The MCP tools for the user's decks, through DeckService as the Decks page does. A deck is given as its cards' ids,
/// so a big one stays small; list_cards with its id pages through the cards.
/// </summary>
[McpServerToolType]
public class DeckTools(DeckService decks)
{
    [McpServerTool(Name = "list_decks", Title = "List decks", ReadOnly = true, OpenWorld = false)]
    [Description("Lists the user's decks by name, with how many cards each has.")]
    public async Task<IReadOnlyList<DeckSummary>> ListDecksAsync()
    {
        return [.. (await decks.GetCardCountsAsync())
            .Select(item => new DeckSummary(item.Deck.Id, item.Deck.Name, item.CardCount))];
    }

    [McpServerTool(Name = "get_deck", Title = "Get a deck", ReadOnly = true, OpenWorld = false)]
    [Description("Gets a deck with its cards' ids. Use list_cards with the deck's id to read the cards.")]
    public async Task<DeckDetail> GetDeckAsync([Description("The deck's id.")] int id)
    {
        var deck = await decks.GetAsync(id) ?? throw ToolErrors.Error(ToolErrors.DeckNotFound);

        return DeckDetail.From(deck);
    }

    [McpServerTool(Name = "create_deck", Title = "Add a deck", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Adds a deck, optionally with some of the user's cards in it. Names are unique ignoring case and up to 50 characters.")]
    public async Task<DeckDetail> CreateDeckAsync(
        [Description("The deck's name.")] string name,
        [Description("The ids of cards to put in the deck.")] int[]? cardIds = null)
    {
        return Saved(await decks.CreateAsync(name ?? string.Empty, cardIds ?? []));
    }

    [McpServerTool(Name = "rename_deck", Title = "Rename a deck", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Renames a deck, keeping its cards.")]
    public async Task<DeckDetail> RenameDeckAsync(
        [Description("The deck's id.")] int id,
        [Description("The deck's new name.")] string name)
    {
        return Saved(await decks.RenameAsync(id, name ?? string.Empty));
    }

    [McpServerTool(Name = "add_cards_to_deck", Title = "Add cards to a deck", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Puts some of the user's cards in a deck. Cards already in it stay as they are.")]
    public async Task<DeckDetail> AddCardsToDeckAsync(
        [Description("The deck's id.")] int id,
        [Description("The ids of the cards to add.")] int[]? cardIds)
    {
        return Saved(await decks.ChangeCardsAsync(id, cardIds ?? [], []));
    }

    [McpServerTool(Name = "remove_cards_from_deck", Title = "Remove cards from a deck", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Takes cards out of a deck, keeping the cards. Ids of cards that aren't in it are skipped.")]
    public async Task<DeckDetail> RemoveCardsFromDeckAsync(
        [Description("The deck's id.")] int id,
        [Description("The ids of the cards to take out.")] int[]? cardIds)
    {
        return Saved(await decks.ChangeCardsAsync(id, [], cardIds ?? []));
    }

    [McpServerTool(Name = "delete_deck", Title = "Delete a deck", Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Deletes a deck. Its cards are kept.")]
    public async Task<string> DeleteDeckAsync([Description("The deck's id.")] int id)
    {
        var result = await decks.DeleteAsync(id);

        return result is DeckResult.Deleted ? "Deleted the deck." : throw ToolErrors.For(result);
    }

    private static DeckDetail Saved(DeckResult result)
    {
        return result is DeckResult.Saved(var deck) ? DeckDetail.From(deck) : throw ToolErrors.For(result);
    }
}
