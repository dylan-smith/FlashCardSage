using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Documents;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Scans a document the user uploads for words and phrases to make cards for, which the user looks over and then adds
/// all at once (see FlashCardsController.CreateMany). Nothing is kept: the document is only read to scan it.
/// </summary>
/// <remarks>
/// The document, its name and the cards made from it are user-provided, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/document-scans")]
public class DocumentScansController(
    FlashCardDbContext dbContext,
    IDocumentScanner scanner,
    ILogger<DocumentScansController> logger) : ApiControllerBase
{
    // The most cards a scan makes. A document with more can be scanned again once they're added, since a scan leaves
    // out the user's cards.
    public const int MaxCandidates = FlashCardBatchRequest.MaxCards;

    // The most of a document's text that's scanned, from its start, which keeps the request under the model
    // deployment's tokens a minute.
    public const int MaxCharacters = 30_000;

    // The biggest document that can be uploaded. A Word document's pictures make it much bigger than its text.
    public const int MaxFileBytes = 10 * 1024 * 1024;

    // A few more than are kept are asked for, since some can turn out to be cards the user already has.
    private const int ExtraRequested = 10;

    // A scanned PDF's pages are pictures of text, which can't be read as text.
    public const string NoTextInPdfMessage =
        "This PDF has no text to scan. Its pages may be scanned pictures of text, which can't be read.";

    private static readonly string[] Articles = ["el ", "la ", "los ", "las ", "the "];

    [HttpPost]
    [RequestSizeLimit(MaxFileBytes + (64 * 1024))]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxFileBytes + (64 * 1024))]
    [ProducesResponseType<DocumentScanResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<DocumentScanResponse>> Scan(IFormFile file, CancellationToken cancellationToken)
    {
        if (!scanner.IsAvailable)
        {
            return ServiceUnavailableProblem("Scanning documents isn't available.");
        }

        if (file.Length > MaxFileBytes)
        {
            ModelState.AddModelError(nameof(file), $"Choose a document under {MaxFileBytes / 1024 / 1024} MB.");
            return ValidationProblem(ModelState);
        }

        // One character more than is scanned, to tell whether there's more.
        string? text;
        try
        {
            await using var stream = file.OpenReadStream();
            text = await DocumentText.ReadAsync(stream, file.FileName, MaxCharacters + 1, cancellationToken);
        }
        catch (InvalidDataException)
        {
            logger.LogWarning("Couldn't read an uploaded Word document");
            ModelState.AddModelError(nameof(file), "The document couldn't be read.");
            return ValidationProblem(ModelState);
        }

        if (text is null)
        {
            ModelState.AddModelError(
                nameof(file),
                $"Choose a {string.Join(", ", DocumentText.Extensions.SkipLast(1))} or {DocumentText.Extensions[^1]} document.");
            return ValidationProblem(ModelState);
        }

        if (string.IsNullOrWhiteSpace(text))
        {
            ModelState.AddModelError(
                nameof(file),
                Path.GetExtension(file.FileName).Equals(".pdf", StringComparison.OrdinalIgnoreCase)
                    ? NoTextInPdfMessage
                    : "The document has no text to scan.");
            return ValidationProblem(ModelState);
        }

        var truncated = text.Length > MaxCharacters;
        if (truncated)
        {
            text = text[..MaxCharacters];
        }

        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .WithWords()
            .OrderBy(card => card.Id)
            .ToListAsync(cancellationToken);

        // The model is only told about the cards for words in the document, which are the ones it could make again, so
        // a long list of cards doesn't make a long request. Any it makes anyway are left out below.
        var inDocument = cards.Where(card => card.Words.Any(word => Contains(text, word.Text))).ToList();

        IReadOnlyList<CardSuggestion> scanned;
        try
        {
            scanned = await scanner.ScanAsync(text, inDocument, MaxCandidates + ExtraRequested, cancellationToken);
        }
        catch (Exception ex) when (IsUpstreamFailure(ex, cancellationToken))
        {
            logger.LogError(ex, "Scanning a document failed");
            return BadGatewayProblem("Scanning the document failed.");
        }

        var candidates = NewCards.From(scanned, cards).Take(MaxCandidates).ToList();
        logger.LogInformation(
            "Scanned a document of {Length} characters into {Count} of {Scanned} cards, telling of {CardCount} cards",
            text.Length,
            candidates.Count,
            scanned.Count,
            inDocument.Count);

        return Ok(new DocumentScanResponse(candidates, truncated));
    }

    // Whether the word is in the text, ignoring case. A noun is often on a card with "el" or "la" before it, which the
    // document may not have, as in "un gato" for el gato, so the noun alone is enough.
    private static bool Contains(string text, string word)
    {
        var article = Articles.FirstOrDefault(item => word.StartsWith(item, StringComparison.OrdinalIgnoreCase));
        var noun = article is null ? word : word[article.Length..];
        return text.Contains(noun, StringComparison.OrdinalIgnoreCase);
    }
}
