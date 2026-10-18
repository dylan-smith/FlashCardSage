using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Makes a picture of what a card means, and puts one on a card or takes it off. A generated picture is handed back
/// to the user and goes on the card only when they ask. Every one is also kept in a cache every user shares (see
/// CachedImageGenerator), so asking again for the same words shows the next picture there is of them, and a new one
/// is only made once the user has seen them all. A card given a generated picture points at it in the cache, which
/// every card with that picture shares and nothing removes; a picture the user uploads is the card's own, and goes
/// when the card's done with it.
/// </summary>
/// <remarks>
/// A card is always looked up first, since that's what limits it to the current user's cards. The words a
/// picture is made from are user-provided, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/flashcards")]
public class FlashCardImagesController(
    FlashCardDbContext dbContext,
    CachedImageGenerator imageGenerator,
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

        if (await imageGenerator.FindAsync(spanish, english, request.AfterId, cancellationToken) is { } cached)
        {
            return Ok(ToResponse(cached));
        }

        if (!imageGenerator.IsAvailable)
        {
            return ServiceUnavailableProblem("Pictures aren't available.");
        }

        try
        {
            var generated = await imageGenerator.GenerateAsync(spanish, english, cancellationToken);
            logger.LogInformation("Generated a {Length} byte picture", generated.Image.Data.Length);
            return Ok(ToResponse(generated));
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

        var previousUrl = card.ImageUrl;
        if (request.GeneratedImageId is { } generatedImageId)
        {
            // A generated picture is in the cache already, so the card points at it there rather than keeping a copy.
            var cached = await dbContext.GeneratedImages
                .AsNoTracking()
                .FirstOrDefaultAsync(item => item.Id == generatedImageId, cancellationToken);
            if (cached is null)
            {
                ModelState.AddModelError(nameof(request.GeneratedImageId), "That picture is gone.");
                return ValidationProblem(ModelState);
            }

            card.ImageUrl = cached.ImageUrl;
            await dbContext.SaveChangesAsync(cancellationToken);
            logger.LogInformation(
                "Put generated picture {GeneratedImageId} on flash card {FlashCardId}", generatedImageId, id);
        }
        else
        {
            if (!CardImage.TryDecode(request.ContentType, request.Data, out var data, out var contentType, out var error))
            {
                ModelState.AddModelError(nameof(request.Data), error);
                return ValidationProblem(ModelState);
            }

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

            logger.LogInformation("Put a {Length} byte picture on flash card {FlashCardId}", data.Length, id);
        }

        if (previousUrl is not null && previousUrl != card.ImageUrl)
        {
            await imageStore.TryDeleteCardPicturesAsync(dbContext, [previousUrl], logger, cancellationToken);
        }

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
            await imageStore.TryDeleteCardPicturesAsync(dbContext, [url], logger, cancellationToken);
            logger.LogInformation("Removed the picture from flash card {FlashCardId}", id);
        }

        return Ok(card);
    }

    private static CardImageResponse ToResponse(CachedGeneratedImage picture)
    {
        return new CardImageResponse(
            picture.Id, picture.Image.ContentType, Convert.ToBase64String(picture.Image.Data.Span));
    }

    // The card with its words and tags, as the other endpoints return it.
    private Task<FlashCard?> FindCardAsync(int id, CancellationToken cancellationToken)
    {
        return dbContext.FlashCards
            .WithWordsAndTags()
            .FirstOrDefaultAsync(card => card.Id == id, cancellationToken);
    }
}
