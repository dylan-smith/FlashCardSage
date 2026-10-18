using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Makes a picture of what a card means, and puts one on a card or takes it off. A generated picture is only
/// handed back to the user: it goes on the card when they ask, so one they don't want is never kept.
/// </summary>
/// <remarks>
/// A card is always looked up first, since that's what limits it to the current user's cards. The words a
/// picture is made from are user-provided, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/flashcards")]
public class FlashCardImagesController(
    FlashCardDbContext dbContext,
    IImageGenerator imageGenerator,
    IImageStore imageStore,
    ILogger<FlashCardImagesController> logger) : ApiControllerBase
{
    [HttpPost("images/generate")]
    [ProducesResponseType<CardImageResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<CardImageResponse>> Generate(
        [FromBody] ImageGenerationRequest request,
        CancellationToken cancellationToken)
    {
        var spanish = TextRules.Clean(request.Spanish);
        var english = TextRules.Clean(request.English);
        if (spanish.Length == 0 && english.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Spanish), "Spanish or English is required.");
            return ValidationProblem(ModelState);
        }

        if (!imageGenerator.IsAvailable)
        {
            return ServiceUnavailableProblem("Pictures aren't available.");
        }

        try
        {
            var image = await imageGenerator.GenerateAsync(spanish, english, cancellationToken);
            logger.LogInformation("Generated a {Length} byte picture", image.Data.Length);
            return Ok(new CardImageResponse(image.ContentType, Convert.ToBase64String(image.Data.Span)));
        }
        catch (ImageContentFilteredException ex)
        {
            logger.LogWarning(ex, "The image generator refused the words");
            return Problem("That card can't be illustrated.", statusCode: StatusCodes.Status422UnprocessableEntity);
        }
        catch (Exception ex) when (IsUpstreamFailure(ex, cancellationToken))
        {
            logger.LogError(ex, "Generating a picture failed");
            return BadGatewayProblem("Generating a picture failed.");
        }
    }

    [HttpPut("{id:int}/image")]
    public async Task<ActionResult<FlashCard>> Put(
        int id, [FromBody] CardImageRequest request, CancellationToken cancellationToken)
    {
        var card = await FindCardAsync(id, cancellationToken);
        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for a picture", id);
            return NotFound();
        }

        if (!CardImage.TryDecode(request.ContentType, request.Data, out var data, out var contentType, out var error))
        {
            ModelState.AddModelError(nameof(request.Data), error);
            return ValidationProblem(ModelState);
        }

        var previousUrl = card.ImageUrl;
        var url = await imageStore.SaveAsync(data, contentType, cancellationToken);
        card.ImageUrl = url;
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch
        {
            // The picture isn't on the card, so it isn't kept either.
            await imageStore.TryDeleteAsync(url, logger, CancellationToken.None);
            throw;
        }

        if (previousUrl is not null)
        {
            await imageStore.TryDeleteAsync(previousUrl, logger, cancellationToken);
        }

        logger.LogInformation("Put a {Length} byte picture on flash card {FlashCardId}", data.Length, id);

        return Ok(card);
    }

    [HttpDelete("{id:int}/image")]
    public async Task<ActionResult<FlashCard>> Delete(int id, CancellationToken cancellationToken)
    {
        var card = await FindCardAsync(id, cancellationToken);
        if (card is null)
        {
            logger.LogWarning("Flash card {FlashCardId} not found for removing its picture", id);
            return NotFound();
        }

        if (card.ImageUrl is { } url)
        {
            card.ImageUrl = null;
            await dbContext.SaveChangesAsync(cancellationToken);
            await imageStore.TryDeleteAsync(url, logger, cancellationToken);
            logger.LogInformation("Removed the picture from flash card {FlashCardId}", id);
        }

        return Ok(card);
    }

    // The card with its words and tags, as the other endpoints return it.
    private Task<FlashCard?> FindCardAsync(int id, CancellationToken cancellationToken)
    {
        return dbContext.FlashCards
            .WithWordsAndTags()
            .FirstOrDefaultAsync(card => card.Id == id, cancellationToken);
    }
}
