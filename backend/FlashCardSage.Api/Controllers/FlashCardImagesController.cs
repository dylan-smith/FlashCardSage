using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

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
/// Pictures are put on cards and taken off by CardPictureService, which always looks the card up first, since that's
/// what limits it to the current user's cards. The words a picture is made from are user-provided, so they're never
/// logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/flashcards")]
public class FlashCardImagesController(
    CachedImageGenerator imageGenerator,
    CardPictureService pictures,
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
        // A generated picture by its ID in the cache, or else one of the user's own, decoded from base64.
        var result = request.GeneratedImageId is { } generatedImageId
            ? await pictures.PutGeneratedAsync(id, generatedImageId, cancellationToken)
            : CardImage.TryDecode(request.ContentType, request.Data, out var data, out var contentType, out var error)
                ? await pictures.PutAsync(id, data, contentType, cancellationToken)
                : new PictureResult.Invalid(nameof(request.Data), error);

        return ToResponse(result);
    }

    [HttpDelete("{id:int}/image")]
    public async Task<ActionResult<FlashCard>> Delete(int id, CancellationToken cancellationToken)
    {
        return ToResponse(await pictures.RemoveAsync(id, cancellationToken));
    }

    private static CardImageResponse ToResponse(CachedGeneratedImage picture)
    {
        return new CardImageResponse(
            picture.Id, picture.Image.ContentType, Convert.ToBase64String(picture.Image.Data.Span));
    }

    // The response for what became of putting a picture on a card or taking it off.
    private ActionResult ToResponse(PictureResult result)
    {
        switch (result)
        {
            case PictureResult.Changed(var card):
                return Ok(card);
            case PictureResult.NotFound:
                return NotFound();
            case PictureResult.Invalid(var field, var message):
                ModelState.AddModelError(field, message);
                return ValidationProblem(ModelState);
            default:
                throw new InvalidOperationException($"Unexpected picture result {result.GetType().Name}.");
        }
    }
}
