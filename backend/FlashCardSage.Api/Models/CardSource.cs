using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// How a card was added: typed in, from a suggestion, scanned from a document, imported from Preply or Duolingo,
// copied from a built-in deck, or by an AI assistant over MCP. Sent and stored by name, so the values can be
// reordered.
[JsonConverter(typeof(JsonStringEnumConverter<CardSource>))]
public enum CardSource
{
    Manual,
    Suggested,
    Document,
    Preply,
    Duolingo,
    SystemDeck,
    Mcp
}
