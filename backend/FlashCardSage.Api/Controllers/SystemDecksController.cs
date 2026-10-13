using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The built-in decks any user can import (see SystemDeckSeeder). Importing copies the deck, its cards and their tags
/// into the user's own, so it's then like a deck they made, and later changes to the built-in deck don't reach it.
/// </summary>
/// <remarks>
/// The system user's decks are the only rows read past the query filter, and only here. The copies are new rows that
/// the context gives the current user. Like FlashCardsController, log statements include ids only, never a name.
/// </remarks>
[ApiController]
[Route("api/system-decks")]
public class SystemDecksController(FlashCardDbContext dbContext, ILogger<SystemDecksController> logger) : ControllerBase
{
    public const string NothingToImportMessage = "You already have all of these cards.";

    public const string ImportClashMessage = "Your cards changed while the deck was being added. Try again.";

    [HttpGet]
    public async Task<ActionResult<IEnumerable<SystemDeckResponse>>> GetAll()
    {
        logger.LogInformation("Retrieving all system decks");

        var decks = await SystemDecks()
            .OrderBy(deck => deck.Name)
            .ToListAsync();

        logger.LogInformation("Retrieved {Count} system decks", decks.Count);

        return Ok(decks.Select(SystemDeckResponse.From).ToList());
    }

    // Copies the deck into the user's decks, leaving out any card whose Spanish or English is already on one of their
    // cards, since a user can't have two cards for a word.
    [HttpPost("{id:int}/import")]
    public async Task<ActionResult<SystemDeckImportResponse>> Import(int id)
    {
        var systemDeck = await SystemDecks().FirstOrDefaultAsync(deck => deck.Id == id);

        if (systemDeck is null)
        {
            logger.LogWarning("System deck {DeckId} not found to import", id);
            return NotFound();
        }

        // Compared in memory, ignoring case, since the in-memory database used in development can't in a query.
        var cards = await dbContext.FlashCards
            .AsNoTracking()
            .Select(card => new { card.Spanish, card.English })
            .ToListAsync();
        var spanish = cards.Select(card => card.Spanish).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var english = cards.Select(card => card.English).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var tags = await dbContext.Tags.ToListAsync();

        var deck = new Deck { Name = await UnusedDeckNameAsync(systemDeck.Name) };
        var skipped = 0;

        foreach (var systemCard in systemDeck.FlashCards.OrderBy(card => card.Id))
        {
            if (spanish.Contains(systemCard.Spanish) || english.Contains(systemCard.English))
            {
                skipped++;
                continue;
            }

            spanish.Add(systemCard.Spanish);
            english.Add(systemCard.English);
            deck.FlashCards.Add(new FlashCard
            {
                Spanish = systemCard.Spanish,
                English = systemCard.English,
                Tags = systemCard.Tags
                    .Select(tag => FindOrMakeTag(tags, tag.Name))
                    .OrderBy(tag => tag.Name, StringComparer.OrdinalIgnoreCase)
                    .ToList()
            });
        }

        if (deck.FlashCards.Count == 0)
        {
            logger.LogInformation("Nothing to import from system deck {DeckId}", id);
            return Problem(detail: NothingToImportMessage, statusCode: StatusCodes.Status409Conflict);
        }

        dbContext.Decks.Add(deck);

        try
        {
            await dbContext.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // A card or deck saved since the checks above failed a unique index.
            dbContext.ChangeTracker.Clear();
            logger.LogWarning("Refused to import system deck {DeckId} over cards saved meanwhile", id);
            return Problem(detail: ImportClashMessage, statusCode: StatusCodes.Status409Conflict);
        }

        logger.LogInformation(
            "Imported system deck {SystemDeckId} as deck {DeckId} with {Count} flash cards, skipping {SkippedCount}",
            id,
            deck.Id,
            deck.FlashCards.Count,
            skipped);

        return CreatedAtAction(
            nameof(DecksController.GetById),
            "Decks",
            new { id = deck.Id },
            new SystemDeckImportResponse(DeckResponse.From(deck), deck.FlashCards.Count, skipped));
    }

    // The system user's decks, with their cards and the cards' tags.
    private IQueryable<Deck> SystemDecks()
    {
        return dbContext.Decks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(deck => dbContext.Users.Any(user => user.Id == deck.UserId && user.Subject == Models.User.SystemSubject))
            .Include(deck => deck.FlashCards)
            .ThenInclude(card => card.Tags);
    }

    // The name, or else the name with the first of " (2)", " (3)" and so on that none of the user's decks has, ignoring
    // case as the database's index does.
    private async Task<string> UnusedDeckNameAsync(string name)
    {
        var names = (await dbContext.Decks.Select(deck => deck.Name).ToListAsync())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var candidate = name;
        for (var number = 2; names.Contains(candidate); number++)
        {
            var suffix = $" ({number})";
            candidate = name[..Math.Min(name.Length, Deck.MaxNameLength - suffix.Length)] + suffix;
        }

        return candidate;
    }

    // The user's tag with this name, ignoring case, or a new one, which is kept with their tags so the deck's other
    // cards use it too.
    private static Tag FindOrMakeTag(List<Tag> tags, string name)
    {
        var tag = tags.FirstOrDefault(item => string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase));

        if (tag is null)
        {
            tag = new Tag { Name = name };
            tags.Add(tag);
        }

        return tag;
    }
}
