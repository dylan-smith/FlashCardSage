using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Imports the built-in decks (see SystemDeckSeeder) for SystemDecksController. Importing copies the deck, its cards,
/// their tags and their pictures into the user's own, so it's then like a deck they made, and later changes to the
/// built-in deck don't reach it. A single card can be imported too, into the user's deck with the built-in deck's name.
/// </summary>
/// <remarks>
/// The system user's decks are the only rows read past the query filter, and only here. The copies are new rows that
/// the context gives the current user. Like FlashCardsController, log statements include ids only, never a name.
/// </remarks>
public class SystemDeckImporter(
    FlashCardDbContext dbContext,
    IImageStore imageStore,
    ILogger<SystemDeckImporter> logger)
{
    // The system user's decks, with their cards and the cards' words and tags.
    public IQueryable<Deck> SystemDecks()
    {
        return dbContext.Decks
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(deck => dbContext.Users.Any(user => user.Id == deck.UserId && user.Subject == User.SystemSubject))
            .Include(deck => deck.FlashCards)
            .ThenInclude(card => card.Words)
            .Include(deck => deck.FlashCards)
            .ThenInclude(card => card.Tags.OrderBy(tag => tag.Name))
            .AsSplitQuery();
    }

    // Copies the deck into the user's decks, leaving out any card whose Spanish or English is already on one of their
    // cards, since a user can't have two cards for a word.
    public async Task<SystemDeckImportResult> ImportDeckAsync(int id, CancellationToken cancellationToken)
    {
        var systemDeck = await SystemDecks().FirstOrDefaultAsync(deck => deck.Id == id, cancellationToken);

        if (systemDeck is null)
        {
            logger.LogWarning("System deck {DeckId} not found to import", id);
            return new SystemDeckImportResult.NotFound();
        }

        var taken = await TakenWords.LoadAsync(dbContext, exceptCardId: null, cancellationToken);
        var tags = await dbContext.Tags.ToListAsync(cancellationToken);

        var deck = new Deck { Name = await UnusedDeckNameAsync(systemDeck.Name, cancellationToken) };
        // Each copy's built-in card's picture, if it has one, copied once there's something to import.
        var pictures = new List<(FlashCard Copy, string Url)>();
        var skipped = 0;

        foreach (var systemCard in systemDeck.FlashCards.OrderBy(card => card.Id))
        {
            // A word is only ever on one of a user's cards, so a card with any word they have is left out.
            if (taken.ContainsAny(systemCard))
            {
                skipped++;
                continue;
            }

            taken.Add(systemCard);

            var copy = systemCard.CopyForUser(tags);
            deck.FlashCards.Add(copy);

            if (systemCard.ImageUrl is { } imageUrl)
            {
                pictures.Add((copy, imageUrl));
            }
        }

        if (deck.FlashCards.Count == 0)
        {
            logger.LogInformation("Nothing to import from system deck {DeckId}", id);
            return new SystemDeckImportResult.NothingToImport();
        }

        // Each card gets a copy of the picture, never the built-in card's own, since deleting the user's card deletes
        // its picture.
        foreach (var (copy, url) in pictures)
        {
            copy.ImageUrl = await TryCopyPictureAsync(url, cancellationToken);
        }

        dbContext.Decks.Add(deck);

        if (!await TrySaveCopiesAsync(deck.FlashCards))
        {
            logger.LogWarning("Refused to import system deck {DeckId} over cards saved meanwhile", id);
            return new SystemDeckImportResult.Clash();
        }

        logger.LogInformation(
            "Imported system deck {SystemDeckId} ({SystemDeckName}) as deck {DeckId} with {Count} flash cards, skipping {SkippedCount}",
            id,
            systemDeck.Name,
            deck.Id,
            deck.FlashCards.Count,
            skipped);

        return new SystemDeckImportResult.DeckImported(deck, skipped);
    }

    // Copies one of the deck's cards into the user's deck with the built-in deck's name, making that deck first if
    // they haven't got one, such as when they've added none of its cards yet. Refused when the card has a word that's
    // already on one of the user's cards.
    public async Task<SystemDeckImportResult> ImportCardAsync(int deckId, int cardId, CancellationToken cancellationToken)
    {
        var systemDeck = await SystemDecks().FirstOrDefaultAsync(deck => deck.Id == deckId, cancellationToken);
        var systemCard = systemDeck?.FlashCards.FirstOrDefault(card => card.Id == cardId);

        if (systemDeck is null || systemCard is null)
        {
            logger.LogWarning("Card {CardId} of system deck {DeckId} not found to import", cardId, deckId);
            return new SystemDeckImportResult.NotFound();
        }

        var taken = await TakenWords.LoadAsync(dbContext, exceptCardId: null, cancellationToken);
        if (taken.ContainsAny(systemCard))
        {
            logger.LogInformation("The user already has card {CardId} of system deck {DeckId}", cardId, deckId);
            return new SystemDeckImportResult.CardTaken();
        }

        var copy = systemCard.CopyForUser(await dbContext.Tags.ToListAsync(cancellationToken));
        var deck = await DeckNamedAsync(systemDeck.Name, cancellationToken);
        var deckCreated = deck is null;
        if (deck is null)
        {
            deck = new Deck { Name = systemDeck.Name };
            dbContext.Decks.Add(deck);
        }

        deck.FlashCards.Add(copy);

        if (systemCard.ImageUrl is { } imageUrl)
        {
            copy.ImageUrl = await TryCopyPictureAsync(imageUrl, cancellationToken);
        }

        if (!await TrySaveCopiesAsync([copy]))
        {
            logger.LogWarning(
                "Refused to import card {CardId} of system deck {DeckId} over cards saved meanwhile", cardId, deckId);
            return new SystemDeckImportResult.Clash();
        }

        logger.LogInformation(
            "Imported card {CardId} of system deck {SystemDeckId} as card {FlashCardId} in deck {DeckId} (new: {DeckCreated})",
            cardId,
            deckId,
            copy.Id,
            deck.Id,
            deckCreated);

        return new SystemDeckImportResult.CardImported(deck, deckCreated, copy);
    }

    // The user's deck with this name, ignoring case as the database's index does, with its cards, or null.
    public async Task<Deck?> DeckNamedAsync(string name, CancellationToken cancellationToken)
    {
        var decks = await dbContext.Decks.Select(deck => new { deck.Id, deck.Name }).ToListAsync(cancellationToken);
        var match = decks.FirstOrDefault(deck => TextRules.SameText(deck.Name, name));

        return match is null
            ? null
            : await dbContext.Decks.WithCards().SingleAsync(deck => deck.Id == match.Id, cancellationToken);
    }

    // The name, or else the name with the first of " (2)", " (3)" and so on that none of the user's decks has, ignoring
    // case as the database's index does.
    public async Task<string> UnusedDeckNameAsync(string name, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(name);

        var names = (await dbContext.Decks.Select(deck => deck.Name).ToListAsync(cancellationToken))
            .ToHashSet(TextRules.Comparer);

        var candidate = name;
        for (var number = 2; names.Contains(candidate); number++)
        {
            var suffix = $" ({number})";
            candidate = name[..Math.Min(name.Length, Deck.MaxNameLength - suffix.Length)] + suffix;
        }

        return candidate;
    }

    // Saves the import, or returns false when a card or deck saved since the checks failed a unique index. Either way
    // when nothing was saved, nothing points at the copied pictures, so they're removed rather than left behind.
    private async Task<bool> TrySaveCopiesAsync(IEnumerable<FlashCard> copies)
    {
        DbUpdateException? clash;
        try
        {
            clash = await dbContext.TrySaveUniqueAsync(CancellationToken.None);
        }
        catch
        {
            await DeleteCopiedPicturesAsync(copies);
            throw;
        }

        if (clash is not null)
        {
            // A card or deck saved since the checks above failed a unique index.
            await DeleteCopiedPicturesAsync(copies);
            return false;
        }

        return true;
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

    private Task DeleteCopiedPicturesAsync(IEnumerable<FlashCard> copies)
    {
        return imageStore.TryDeleteAllAsync(copies.Select(card => card.ImageUrl), logger, CancellationToken.None);
    }
}
