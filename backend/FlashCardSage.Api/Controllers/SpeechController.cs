using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Speech;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Reads a card's Spanish aloud, so the user can hear how it's said. Each word or phrase is read on its own, with the
/// intonation of a phrase or sentence rather than word by word, and the audio is kept in a cache every user shares
/// (see CachedSpeechSynthesizer), so a phrase is only paid for the first time anyone asks to hear it. The browser plays
/// the audio from the URLs this returns.
/// </summary>
/// <remarks>
/// The texts being read are user-provided, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/speech")]
public class SpeechController(CachedSpeechSynthesizer speech, ILogger<SpeechController> logger) : ApiControllerBase
{
    [HttpPost]
    [ProducesResponseType<SpeechResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<SpeechResponse>> Speak(
        [FromBody] SpeechRequest request,
        CancellationToken cancellationToken)
    {
        var texts = request.Texts.Select(TextRules.Clean).ToList();
        if (texts.Any(text => text.Length == 0))
        {
            ModelState.AddModelError(nameof(request.Texts), "Each text is required.");
            return ValidationProblem(ModelState);
        }

        if (texts.Any(text => text.Length > FlashCard.MaxWordLength))
        {
            ModelState.AddModelError(nameof(request.Texts), $"A text can be at most {FlashCard.MaxWordLength} characters.");
            return ValidationProblem(ModelState);
        }

        var urls = new List<string>(texts.Count);
        var synthesized = 0;
        foreach (var text in texts)
        {
            if (await speech.FindUrlAsync(text, cancellationToken) is { } cached)
            {
                urls.Add(cached);
                continue;
            }

            if (!speech.IsAvailable)
            {
                return ServiceUnavailableProblem("Audio isn't available.");
            }

            try
            {
                urls.Add(await speech.SynthesizeAsync(text, cancellationToken));
                synthesized++;
            }
            catch (Exception ex) when (IsUpstreamFailure(ex, cancellationToken))
            {
                logger.LogError(ex, "Reading {Length} characters aloud failed", text.Length);
                return BadGatewayProblem("Loading the audio failed.");
            }
        }

        logger.LogInformation("Read {Count} texts aloud, {Synthesized} of them anew", texts.Count, synthesized);
        return Ok(new SpeechResponse(urls));
    }
}
