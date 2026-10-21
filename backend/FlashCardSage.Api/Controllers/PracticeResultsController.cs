using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Records the answers the device kept while practicing on its own (offline too), all at once.
/// FlashCardScoresController scores the cards from them.
/// </summary>
[ApiController]
[Route("api/flashcards/practice-results")]
public class PracticeResultsController(PracticeService practiceService) : ControllerBase
{
    // The answers the device kept, oldest first. Each is recorded once, by the id the device gave it, so the device
    // can send them again when it didn't hear back. Answers for cards that are gone (or were never the user's) are
    // skipped rather than refused, since the device can't do anything else with them.
    [HttpPost]
    public async Task<ActionResult<PracticeResultsSyncResponse>> Sync(
        [FromBody] PracticeResultsSyncRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Every property is required, so the model binder has already refused a request without one.
        var results = request.Results
            .Select(item => (
                Id: item.Id!.Value,
                FlashCardId: item.FlashCardId!.Value,
                Outcome: item.Outcome!.Value,
                PracticedAt: item.PracticedAt!.Value))
            .ToList();

        var accepted = await practiceService.RecordResultsAsync(results, cancellationToken);

        return Ok(new PracticeResultsSyncResponse(accepted));
    }
}
