using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Sends everything it takes to practice on the device (offline too) in one pack, for the device to pick the cards
/// from itself. PracticeResultsController records the answers the device kept.
/// </summary>
[ApiController]
[Route("api/flashcards/practice")]
public class PracticeController(FlashCardDbContext dbContext, ILogger<PracticeController> logger) : ControllerBase
{
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
