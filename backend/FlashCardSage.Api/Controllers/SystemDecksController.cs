using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The built-in decks any user can import (see SystemDeckSeeder). Importing copies the deck, its cards, their tags and
/// their pictures into the user's own, so it's then like a deck they made, and later changes to the built-in deck don't reach it.
/// </summary>
/// <remarks>
/// The system user's decks are the only rows read past the query filter, and only here. The copies are new rows that
/// the context gives the current user. Like FlashCardsController, log statements include ids only, never a name.
/// </remarks>
[ApiController]
[Route("api/system-decks")]
public class SystemDecksController(
    FlashCardDbContext dbContext,
    IImageStore imageStore,
    ILogger<SystemDecksController> logger) : ControllerBase
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
    public async Task<ActionResult<SystemDeckImportResponse>> Import(int id, CancellationToken cancellationToken)
    {
        var systemDeck = await SystemDecks().FirstOrDefaultAsync(deck => deck.Id == id, cancellationToken);

        if (systemDeck is null)
        {
            logger.LogWarning("System deck {DeckId} not found to import", id);
            return NotFound();
        }

        // The words on the user's cards, by language. Compared in memory, ignoring case, since the in-memory database
        // used in development can't in a query.
        var words = await dbContext.FlashCardWords
            .AsNoTracking()
            .Select(word => new { word.Language, word.Text })
            .ToListAsync(cancellationToken);
        var taken = Enum.GetValues<Language>().ToDictionary(
            language => language,
            language => words
                .Where(word => word.Language == language)
                .Select(word => word.Text)
                .ToHashSet(StringComparer.OrdinalIgnoreCase));
        var tags = await dbContext.Tags.ToListAsync(cancellationToken);

        var deck = new Deck { Name = await UnusedDeckNameAsync(systemDeck.Name, cancellationToken) };
        // Each copy's built-in card's picture, if it has one, copied once there's something to import.
        var pictures = new List<(FlashCard Copy, string Url)>();
        var skipped = 0;

        foreach (var systemCard in systemDeck.FlashCards.OrderBy(card => card.Id))
        {
            // A word is only ever on one of a user's cards, so a card with any word they have is left out.
            if (systemCard.Words.Any(word => taken[word.Language].Contains(word.Text)))
            {
                skipped++;
                continue;
            }

            foreach (var word in systemCard.Words)
            {
                taken[word.Language].Add(word.Text);
            }

            var copy = new FlashCard
            {
                Words =
                [
                    .. systemCard.Words.Select(word =>
                        new FlashCardWord { Language = word.Language, Text = word.Text, Position = word.Position })
                ],
                Tags = systemCard.Tags
                    .Select(tag => FindOrMakeTag(tags, tag.Name))
                    .OrderBy(tag => tag.Name, StringComparer.OrdinalIgnoreCase)
                    .ToList()
            };
            deck.FlashCards.Add(copy);

            if (systemCard.ImageUrl is { } imageUrl)
            {
                pictures.Add((copy, imageUrl));
            }
        }

        if (deck.FlashCards.Count == 0)
        {
            logger.LogInformation("Nothing to import from system deck {DeckId}", id);
            return Problem(detail: NothingToImportMessage, statusCode: StatusCodes.Status409Conflict);
        }

        // Each card gets a copy of the picture, never the built-in card's own, since deleting the user's card deletes
        // its picture.
        foreach (var (copy, url) in pictures)
        {
            copy.ImageUrl = await TryCopyPictureAsync(url, cancellationToken);
        }

        dbContext.Decks.Add(deck);

        try
        {
            await dbContext.SaveChangesAsync(CancellationToken.None);
        }
        catch (DbUpdateException)
        {
            // A card or deck saved since the checks above failed a unique index.
            dbContext.ChangeTracker.Clear();
            await DeleteCopiedPicturesAsync(deck);
            logger.LogWarning("Refused to import system deck {DeckId} over cards saved meanwhile", id);
            return Problem(detail: ImportClashMessage, statusCode: StatusCodes.Status409Conflict);
        }
        catch
        {
            // Nothing points at the copied pictures, so they're removed rather than left behind.
            await DeleteCopiedPicturesAsync(deck);
            throw;
        }

        logger.LogInformation(
            "Imported system deck {SystemDeckId} ({SystemDeckName}) as deck {DeckId} with {Count} flash cards, skipping {SkippedCount}",
            id,
            systemDeck.Name,
            deck.Id,
            deck.FlashCards.Count,
            skipped);

        return CreatedAtAction(
            nameof(DecksController.GetById),
            "Decks",
            new { id = deck.Id },
            new SystemDeckImportResponse(DeckResponse.From(deck), deck.FlashCards.Count, skipped));
    }

    // A copy of the picture, or null when it's gone or can't be copied. The picture is only a nicety, so the card is
    // imported without one rather than failing the whole deck.
    private async Task<string?> TryCopyPictureAsync(string url, CancellationToken cancellationToken)
    {
        try
        {
            return await imageStore.CopyAsync(url, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogWarning(ex, "A built-in card's picture couldn't be copied, so the card is imported without it");
            return null;
        }
    }

    private async Task DeleteCopiedPicturesAsync(Deck deck)
    {
        foreach (var url in deck.FlashCards.Select(card => card.ImageUrl).OfType<string>())
        {
            await imageStore.TryDeleteAsync(url, logger, CancellationToken.None);
        }
    }

    // The system user's decks, with their cards and the cards' words and tags.
    private IQueryable<Deck> SystemDecks()
    {
        return dbContext.Decks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(deck => dbContext.Users.Any(user => user.Id == deck.UserId && user.Subject == Models.User.SystemSubject))
            .Include(deck => deck.FlashCards)
            .ThenInclude(card => card.Words)
            .Include(deck => deck.FlashCards)
            .ThenInclude(card => card.Tags.OrderBy(tag => tag.Name))
            .AsSplitQuery();
    }

    // The name, or else the name with the first of " (2)", " (3)" and so on that none of the user's decks has, ignoring
    // case as the database's index does.
    private async Task<string> UnusedDeckNameAsync(string name, CancellationToken cancellationToken)
    {
        var names = (await dbContext.Decks.Select(deck => deck.Name).ToListAsync(cancellationToken))
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
