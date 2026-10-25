using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Sentences practice mode: short sentences written from the user's cards for them to practice, and their answers to
/// them, which are kept to learn from but don't count toward any card's score.
/// </summary>
/// <remarks>
/// The sentences are made from the user's cards, so they're never logged (log-forging).
/// </remarks>
[ApiController]
[Route("api/flashcards/practice/sentences")]
public class SentencePracticeController(
    FlashCardService flashCards,
    ISentenceGenerator generator,
    SentencePracticeService sentencePractice,
    ILogger<SentencePracticeController> logger) : ApiControllerBase
{
    // A handful at a time, so the device can ask for more as the user works through them.
    public const int SentenceCount = 5;

    // Fewer cards than this don't make sentences different enough to practice.
    public const int MinCards = 3;

    // The most cards the sentences are written from, picked at random each time, so the sentences use different cards
    // from one batch to the next and a long list doesn't make a long request.
    public const int MaxCardsDescribed = 40;

    // A couple more than are returned are asked for, since some can turn out to be unusable.
    private const int ExtraRequested = 2;

    /// <summary>
    /// Writes sentences from the user's cards, or a deck's or a tag's. Not found when the deck or tag isn't the user's.
    /// </summary>
    [HttpGet]
    [ProducesResponseType<IEnumerable<PracticeSentence>>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status502BadGateway)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<IEnumerable<PracticeSentence>>> Get(
        [FromQuery] PracticeSelection selection, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(selection);

        if (!generator.IsAvailable)
        {
            return ServiceUnavailableProblem("Sentences aren't available.");
        }

        if (await flashCards.ListAsync(selection.DeckId, selection.TagId) is not { } cards)
        {
            logger.LogWarning(
                "Deck {DeckId} or tag {TagId} not found to make sentences from", selection.DeckId, selection.TagId);
            return NotFound();
        }

        if (cards.Count < MinCards)
        {
            ModelState.AddModelError("Cards", $"Practicing sentences needs at least {MinCards} cards.");
            return ValidationProblem(ModelState);
        }

        // Every card is as likely to be picked. Favouring the ones the user knows least can come once there's sentence
        // practice data to go by.
        var shuffled = cards.ToArray();
        Random.Shared.Shuffle(shuffled);
        var described = shuffled.Take(MaxCardsDescribed).OrderBy(card => card.Id).ToList();

        IReadOnlyList<PracticeSentence> generated;
        try
        {
            generated = await generator.GenerateAsync(described, SentenceCount + ExtraRequested, cancellationToken);
        }
        catch (Exception ex) when (IsUpstreamFailure(ex, cancellationToken))
        {
            logger.LogError(ex, "Making sentences failed");
            return BadGatewayProblem("Making sentences failed.");
        }

        var sentences = NewSentences.From(generated, cards)
            .Take(SentenceCount)
            .ToList();
        logger.LogInformation(
            "Made {Count} of {Generated} sentences from {Described} of {CardCount} cards",
            sentences.Count, generated.Count, described.Count, cards.Count);

        return Ok(sentences);
    }

    /// <summary>
    /// Records the user's answer to a sentence. Card ids that aren't the user's cards are left out.
    /// </summary>
    [HttpPost("results")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<IActionResult> Record(
        [FromBody] SentencePracticeResultRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var spanish = TextRules.Clean(request.Spanish);
        var english = TextRules.Clean(request.English);
        if (spanish.Length == 0)
        {
            ModelState.AddModelError(nameof(request.Spanish), "Enter the Spanish sentence.");
        }

        if (english.Length == 0)
        {
            ModelState.AddModelError(nameof(request.English), "Enter the English sentence.");
        }

        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        // The rest are required, so the model binder has already refused a request without one.
        await sentencePractice.RecordAsync(
            spanish,
            english,
            request.CardIds!,
            request.ShownSide!.Value,
            request.Listening!.Value,
            request.Outcome!.Value,
            cancellationToken);

        return NoContent();
    }
}
