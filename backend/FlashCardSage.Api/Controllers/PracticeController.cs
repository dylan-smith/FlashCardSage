using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Picks the card to start practicing with, and PracticeResultsController picks each one after that. Or, to practice
/// on the device (offline too), sends everything it takes in one pack, and PracticeResultsController records the
/// answers the device kept.
/// </summary>
[ApiController]
[Route("api/flashcards/practice")]
public class PracticeController(FlashCardDbContext dbContext, ILogger<PracticeController> logger) : ControllerBase
{
    // From all the user's cards, or a deck's or a tag's. No content when there are no cards to practice, and not
    // found when the deck or tag isn't the user's.
    [HttpGet("next")]
    [ProducesResponseType<PracticeCard>(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public async Task<ActionResult<PracticeCard>> GetNext([FromQuery] PracticeSelection selection)
    {
        if (!await dbContext.SelectionExistsAsync(selection))
        {
            logger.LogWarning(
                "Deck {DeckId} or tag {TagId} not found to practice", selection.DeckId, selection.TagId);
            return NotFound();
        }

        var next = await PracticePicker.PickNextAsync(dbContext, previousId: null, selection);
        if (next is null)
        {
            logger.LogInformation("No flash cards to practice");
            return NoContent();
        }

        logger.LogInformation("Picked flash card {FlashCardId} to practice", next.Id);
        return Ok(next);
    }

    // All the user's cards with their scores and tags, and their decks and tags, for the device to keep and pick the
    // cards to practice from itself.
    [HttpGet("pack")]
    public async Task<ActionResult<PracticePack>> GetPack()
    {
        var scores = await dbContext.ScoreFlashCardsAsync(null);

        var links = await dbContext.FlashCards
            .AsNoTracking()
            .SelectMany(card => card.Tags.Select(tag => new { FlashCardId = card.Id, TagId = tag.Id }))
            .OrderBy(link => link.TagId)
            .ToListAsync();
        var tagIdsByCard = links.ToLookup(link => link.FlashCardId, link => link.TagId);

        var decks = await dbContext.Decks
            .AsNoTracking()
            .WithCards()
            .OrderBy(deck => deck.Name)
            .ToListAsync();

        var tags = await dbContext.Tags
            .AsNoTracking()
            .OrderBy(tag => tag.Name)
            .ToListAsync();

        var cards = scores
            .Select(card => new PracticePackCard(
                card.Id,
                card.Spanish,
                card.English,
                card.Score,
                card.LastPracticedAt,
                card.ImageUrl,
                [.. tagIdsByCard[card.Id]]))
            .ToList();

        logger.LogInformation(
            "Packed {CardCount} flash cards, {DeckCount} decks and {TagCount} tags to practice",
            cards.Count,
            decks.Count,
            tags.Count);

        return Ok(new PracticePack(cards, [.. decks.Select(DeckResponse.From)], tags));
    }
}
