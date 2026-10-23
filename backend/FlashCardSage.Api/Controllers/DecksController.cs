using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Sharing;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The user's decks, each a named set of their cards to practice. A deck can hold hundreds of cards, so they're
/// added and removed a few at a time (or all the ones the user picked) rather than sent in full with each change.
/// </summary>
/// <remarks>
/// Like FlashCardsController, log statements include ids only, never a deck's name. The changes are made by
/// DeckService, and decks are shared as files by DeckSharingService, and this turns what became of them into responses.
/// </remarks>
[ApiController]
[Route("api/decks")]
public class DecksController(
    DeckService deckService,
    DeckSharingService sharing,
    ILogger<DecksController> logger) : ApiControllerBase
{
    public const string ImportClashMessage = "Your cards changed while the deck was being imported. Try again.";

    [HttpGet]
    public async Task<ActionResult<IEnumerable<DeckResponse>>> GetAll()
    {
        logger.LogInformation("Retrieving all decks");

        var decks = await deckService.GetAllAsync();

        logger.LogInformation("Retrieved {Count} decks", decks.Count);

        return Ok(decks.Select(DeckResponse.From).ToList());
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<DeckResponse>> GetById(int id)
    {
        logger.LogInformation("Retrieving deck {DeckId}", id);

        var deck = await deckService.GetAsync(id);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found", id);
            return NotFound();
        }

        return Ok(DeckResponse.From(deck));
    }

    [HttpPost]
    public async Task<ActionResult<DeckResponse>> Create([FromBody] DeckRequest request)
    {
        return ToResponse(await deckService.CreateAsync(request.Name, request.FlashCardIds), created: true);
    }

    // Renames the deck, leaving its cards as they are.
    [HttpPut("{id:int}")]
    public async Task<ActionResult<DeckResponse>> Rename(int id, [FromBody] DeckNameRequest request)
    {
        return ToResponse(await deckService.RenameAsync(id, request.Name));
    }

    // Adds and removes cards, and returns the deck with all its cards.
    [HttpPatch("{id:int}/cards")]
    public async Task<ActionResult<DeckResponse>> ChangeCards(int id, [FromBody] DeckCardsRequest request)
    {
        return ToResponse(await deckService.ChangeCardsAsync(id, request.Add, request.Remove));
    }

    // The deck as a file to share: a YAML file, or a zip file of it and the pictures of the user's own on its cards.
    [HttpGet("{id:int}/export")]
    [ProducesResponseType<FileContentResult>(StatusCodes.Status200OK, DeckPackage.YamlContentType, DeckPackage.ZipContentType)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<IActionResult> Export(int id, CancellationToken cancellationToken)
    {
        var export = await sharing.ExportAsync(id, cancellationToken);
        return export is null ? NotFound() : File(export.Content, export.ContentType, export.FileName);
    }

    // Makes a new deck from a deck file someone shared (see Export). The cards the user has already go in it as they
    // are.
    [HttpPost("import")]
    [RequestSizeLimit(DeckPackage.MaxFileBytes + (64 * 1024))]
    [RequestFormLimits(MultipartBodyLengthLimit = DeckPackage.MaxFileBytes + (64 * 1024))]
    [ProducesResponseType<DeckImportResponse>(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public async Task<ActionResult<DeckImportResponse>> Import(IFormFile file, CancellationToken cancellationToken)
    {
        if (file.Length > DeckPackage.MaxFileBytes)
        {
            ModelState.AddModelError(
                nameof(file), $"Choose a deck file under {DeckPackage.MaxFileBytes / 1024 / 1024} MB.");
            return ValidationProblem(ModelState);
        }

        var data = new byte[file.Length];
        await using (var stream = file.OpenReadStream())
        {
            await stream.ReadExactlyAsync(data, cancellationToken);
        }

        switch (await sharing.ImportAsync(data, cancellationToken))
        {
            case DeckImportResult.Imported imported:
                return CreatedAtAction(
                    nameof(GetById),
                    new { id = imported.Deck.Id },
                    new DeckImportResponse(
                        DeckResponse.From(imported.Deck),
                        imported.ImportedCount,
                        imported.ExistingCount,
                        imported.SkippedCount,
                        imported.MissingPictureCount));
            case DeckImportResult.Invalid(var message):
                ModelState.AddModelError(nameof(file), message);
                return ValidationProblem(ModelState);
            case DeckImportResult.Clash:
                return ConflictProblem(ImportClashMessage);
            case var result:
                throw new InvalidOperationException($"Unexpected import result {result.GetType().Name}.");
        }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        return ToResponse(await deckService.DeleteAsync(id));
    }

    // The response for what became of a change, a 201 for a saved deck that's new.
    private ActionResult ToResponse(DeckResult result, bool created = false)
    {
        switch (result)
        {
            case DeckResult.Saved(var deck):
                return created
                    ? CreatedAtAction(nameof(GetById), new { id = deck.Id }, DeckResponse.From(deck))
                    : Ok(DeckResponse.From(deck));
            case DeckResult.Deleted:
                return NoContent();
            case DeckResult.NotFound:
                return NotFound();
            case DeckResult.Invalid(var errors):
                foreach (var (field, message) in errors)
                {
                    ModelState.AddModelError(field, message);
                }

                return ValidationProblem(ModelState);
            default:
                throw new InvalidOperationException($"Unexpected deck result {result.GetType().Name}.");
        }
    }
}
