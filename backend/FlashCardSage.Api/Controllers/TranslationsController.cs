using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Translation;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Translates one side of a card into the other, so the user only has to type one of them.
/// </summary>
/// <remarks>
/// The text being translated is user-provided, so it's never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/translations")]
public class TranslationsController(ITranslator translator, ILogger<TranslationsController> logger) : ControllerBase
{
    [HttpPost]
    [ProducesResponseType<TranslationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<TranslationResponse>> Translate(
        [FromBody] TranslationRequest request,
        CancellationToken cancellationToken)
    {
        var text = request.Text.Trim();
        if (text.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Text), "Text is required.");
            return ValidationProblem(ModelState);
        }

        if (!translator.IsAvailable)
        {
            return Problem("Translation isn't available.", statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        var from = request.From!.Value;
        try
        {
            var translation = await translator.TranslateAsync(text, from, cancellationToken);
            logger.LogInformation("Translated {Length} characters from {Language}", text.Length, from);
            return Ok(new TranslationResponse(translation.Text, translation.Alternatives));
        }
        // A timeout surfaces as a cancellation the caller didn't ask for.
        catch (Exception ex) when (ex is HttpRequestException
            || (ex is TaskCanceledException && !cancellationToken.IsCancellationRequested))
        {
            logger.LogError(ex, "Translating from {Language} failed", from);
            return Problem("Translation failed.", statusCode: StatusCodes.Status502BadGateway);
        }
    }
}
