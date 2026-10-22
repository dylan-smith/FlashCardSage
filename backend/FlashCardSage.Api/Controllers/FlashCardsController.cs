using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <remarks>
/// Log statements use structured logging with typed route parameters (e.g. int id) only.
/// User-provided strings such as a card's words or tags are intentionally excluded to prevent log-forging.
/// The changes are made by FlashCardService, and this turns what became of them into responses.
/// </remarks>
[ApiController]
[Route("api/flashcards")]
public class FlashCardsController(
    FlashCardService flashCards,
    ILogger<FlashCardsController> logger) : ApiControllerBase
{
    // The 409 for a word that's already on another of the user's cards (see CardResult.Duplicate).
    public static string DuplicateMessage(Language language, string word)
    {
        return CardResult.Duplicate.DuplicateMessage(language, word);
    }

    public const string BatchClashMessage = "Your cards changed while these were being added. Try again.";

    // In the order they were made, so a list of words stays in the order it was typed in.
    [HttpGet]
    public async Task<ActionResult<IEnumerable<FlashCard>>> GetAll()
    {
        logger.LogInformation("Retrieving all flash cards");

        var cards = await flashCards.GetAllAsync();

        logger.LogInformation("Retrieved {Count} flash cards", cards.Count);

        return Ok(cards);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<FlashCard>> GetById(int id)
    {
        logger.LogInformation("Retrieving flash card {FlashCardId}", id);

        var card = await flashCards.GetAsync(id);

        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found", id);
            return NotFound();
        }

        return Ok(card);
    }

    [HttpPost]
    public async Task<ActionResult<FlashCard>> Create([FromBody] FlashCardRequest request)
    {
        return ToResponse(await flashCards.CreateAsync(request, request.Source ?? CardSource.Manual));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<FlashCard>> Update(int id, [FromBody] FlashCardRequest request)
    {
        return ToResponse(await flashCards.UpdateAsync(id, request));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        return await flashCards.DeleteAsync(id) ? NoContent() : NotFound();
    }

    // Adds the cards, such as the ones scanned from a document, leaving out any whose words the user already has
    // (see FlashCardService.CreateManyAsync).
    [HttpPost("batch")]
    public async Task<ActionResult<FlashCardBatchResponse>> CreateMany([FromBody] FlashCardBatchRequest request)
    {
        return await flashCards.CreateManyAsync(request.Cards, request.Source ?? CardSource.Manual) switch
        {
            CardResult.CreatedMany created => Ok(new FlashCardBatchResponse(created.Cards, created.SkippedCount)),
            var result => ToResponse(result)
        };
    }

    // Deletes many cards at once, such as all the ones picked on the cards page, skipping any that are gone.
    [HttpPost("delete")]
    public async Task<IActionResult> DeleteMany([FromBody] FlashCardIdsRequest request)
    {
        await flashCards.DeleteManyAsync(request.FlashCardIds);
        return NoContent();
    }

    // The response for a single card's result, or a batch's failure.
    private ActionResult ToResponse(CardResult result)
    {
        switch (result)
        {
            case CardResult.Created(var card):
                return CreatedAtAction(nameof(GetById), new { id = card.Id }, card);
            case CardResult.Updated(var card):
                return Ok(card);
            case CardResult.NotFound:
                return NotFound();
            case CardResult.Invalid(var errors):
                foreach (var (field, message) in errors)
                {
                    ModelState.AddModelError(field, message);
                }

                return ValidationProblem(ModelState);
            // A 409 that says which word is taken.
            case CardResult.Duplicate duplicate:
                return ConflictProblem(duplicate.Message);
            case CardResult.Clash:
                return ConflictProblem(BatchClashMessage);
            default:
                throw new InvalidOperationException($"Unexpected card result {result.GetType().Name}.");
        }
    }
}
