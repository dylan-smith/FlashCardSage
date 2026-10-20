using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Services;
using ModelContextProtocol;

namespace FlashCardSage.Api.Mcp;

/// <summary>
/// Turns what went wrong with a change into the error the MCP tool reports. The SDK passes an McpException's message on
/// to the assistant (any other exception's is hidden), so these are the same messages the controllers give the
/// frontend, worded for the user.
/// </summary>
public static class ToolErrors
{
    public const string CardNotFound = "You have no flash card with that id.";

    public const string TagNotFound = "You have no tag with that id.";

    public const string DeckNotFound = "You have no deck with that id.";

    public static McpException Error(string message)
    {
        return new McpException(message);
    }

    public static McpException For(CardResult result)
    {
        return result switch
        {
            CardResult.NotFound => Error(CardNotFound),
            CardResult.Invalid(var errors) => Invalid(errors),
            // Names the card that has the word, so the assistant can add the translation to it with update_card.
            CardResult.Duplicate duplicate =>
                Error($"{duplicate.Message.TrimEnd('.')} (card {duplicate.Word.FlashCardId})."),
            CardResult.Clash => Error(FlashCardsController.BatchClashMessage),
            _ => throw new InvalidOperationException($"Unexpected card result {result.GetType().Name}.")
        };
    }

    public static McpException For(TagResult result)
    {
        return result switch
        {
            TagResult.NotFound => Error(TagNotFound),
            TagResult.Invalid(var errors) => Invalid(errors),
            _ => throw new InvalidOperationException($"Unexpected tag result {result.GetType().Name}.")
        };
    }

    public static McpException For(DeckResult result)
    {
        return result switch
        {
            DeckResult.NotFound => Error(DeckNotFound),
            DeckResult.Invalid(var errors) => Invalid(errors),
            _ => throw new InvalidOperationException($"Unexpected deck result {result.GetType().Name}.")
        };
    }

    public static McpException For(PictureResult result)
    {
        return result switch
        {
            PictureResult.NotFound => Error(CardNotFound),
            PictureResult.Invalid(_, var message) => Error(message),
            _ => throw new InvalidOperationException($"Unexpected picture result {result.GetType().Name}.")
        };
    }

    // The messages, in order. One about a card in a list (a field like "Cards[2].Spanish") says which card it is.
    public static McpException Invalid(IReadOnlyList<KeyValuePair<string, string>> errors)
    {
        return Error(string.Join(' ', errors.Select(error => error.Key.StartsWith("Cards[", StringComparison.Ordinal)
            ? $"cards[{error.Key[6..error.Key.IndexOf(']', StringComparison.Ordinal)]}]: {error.Value}"
            : error.Value)));
    }
}
