using System.ComponentModel;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Services;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace FlashCardSage.Api.Mcp;

/// <summary>
/// The MCP tools that put a picture on one of the user's cards or take it off, through CardPictureService as the cards
/// page does.
/// </summary>
/// <remarks>
/// A picture comes either from an https URL, which RemotePictureFetcher downloads only from the public internet, or as
/// base64. The card is looked up first, so a URL is never downloaded for a card the user doesn't have.
/// </remarks>
[McpServerToolType]
public class PictureTools(FlashCardDbContext dbContext, CardPictureService pictures, RemotePictureFetcher fetcher)
{
    public const string OneSourceMessage = "Give either a picture URL or the picture's data, not both.";

    public const string NoSourceMessage = "Give a picture URL or the picture's data.";

    [McpServerTool(Name = "set_card_picture", Title = "Put a picture on a flash card", Destructive = false, Idempotent = false, OpenWorld = true)]
    [Description("Puts a picture of what a flash card means on it, replacing any it had: a JPEG, PNG or WebP of up to 5 MB, downloaded from a public https URL or given as base64 data. Give either url, or data and contentType.")]
    public async Task<CardSummary> SetCardPictureAsync(
        [Description("The card's id.")] int cardId,
        [Description("A public https URL of the picture, which is downloaded.")] string? url = null,
        [Description("The picture's bytes as base64, instead of a URL.")] string? data = null,
        [Description("The picture's content type when giving data: image/jpeg, image/png or image/webp.")] string? contentType = null,
        CancellationToken cancellationToken = default)
    {
        var hasUrl = !string.IsNullOrWhiteSpace(url);
        var hasData = !string.IsNullOrEmpty(data);
        if (hasUrl && hasData)
        {
            throw ToolErrors.Error(OneSourceMessage);
        }

        if (!hasUrl && !hasData)
        {
            throw ToolErrors.Error(NoSourceMessage);
        }

        if (!await dbContext.FlashCards.AnyAsync(card => card.Id == cardId, cancellationToken))
        {
            throw ToolErrors.Error(ToolErrors.CardNotFound);
        }

        var (picture, pictureContentType) = hasUrl
            ? await DownloadAsync(url!.Trim(), cancellationToken)
            : CardImage.TryDecode(contentType, data, out var decoded, out var decodedContentType, out var error)
                ? (decoded, decodedContentType)
                : throw ToolErrors.Error(error);

        var result = await pictures.PutAsync(cardId, picture, pictureContentType, cancellationToken);

        return result is PictureResult.Changed(var card) ? CardSummary.From(card) : throw ToolErrors.For(result);
    }

    [McpServerTool(Name = "remove_card_picture", Title = "Take a flash card's picture off", Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Takes the picture off a flash card. A card with no picture is left as it is.")]
    public async Task<CardSummary> RemoveCardPictureAsync(
        [Description("The card's id.")] int cardId,
        CancellationToken cancellationToken = default)
    {
        var result = await pictures.RemoveAsync(cardId, cancellationToken);

        return result is PictureResult.Changed(var card) ? CardSummary.From(card) : throw ToolErrors.For(result);
    }

    // The picture at the URL, or an error saying why it wasn't downloaded.
    private async Task<(ReadOnlyMemory<byte> Data, string ContentType)> DownloadAsync(
        string url, CancellationToken cancellationToken)
    {
        return await fetcher.FetchAsync(url, cancellationToken) switch
        {
            RemotePictureResult.Fetched(var data, var contentType) => (data, contentType),
            RemotePictureResult.Refused(var reason) => throw ToolErrors.Error(reason),
            _ => throw new InvalidOperationException("Unexpected picture download result.")
        };
    }
}
