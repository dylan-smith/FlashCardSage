using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Mcp;

// What the MCP server tells the assistant when it connects: the rules of the user's cards that hold across the tools.
// Each tool's own description says what it does.
public static class McpInstructions
{
    public static readonly string Text = $"""
        FlashCardSage keeps the signed-in user's flash cards for learning Spanish. Every tool acts only on that user's own cards, tags and decks.

        - A card holds one meaning: 1 to {FlashCard.MaxWordsPerSide} Spanish words or phrases and 1 to {FlashCard.MaxWordsPerSide} English ones, each up to {FlashCard.MaxWordLength} characters (e.g. "solo" and "únicamente" for "only").
        - A word can be on only one of the user's cards in each language, ignoring case. Adding it again is refused with an error that names the card that has it, as "(card N)"; add the new translation to that card with update_card instead.
        - Tags label cards (e.g. Food, Travel). Putting a tag name on a card makes the tag if the user doesn't have it yet. Names match ignoring case and are up to {Tag.MaxNameLength} characters.
        - A card can have one picture of what it means, shown in practice once the card is revealed.
        - Decks are named sets of cards to practice. Deleting a deck keeps its cards.
        - A card's practice score is 0 to {PracticeScore.Maximum}, from how many times in a row it was last answered "Got it" in practice.
        - Before adding cards in bulk, call list_tags and list_decks to reuse the user's names, and prefer create_cards over many create_card calls.
        """;
}
