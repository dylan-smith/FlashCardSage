using System.Text;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Sharing;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Writes the user's deck to a file to share, and imports one someone shared, such as a teacher's deck for a lesson
/// (see DeckPackage). A generated picture is shared by its id in the cache, which every user shares, and a picture of
/// the user's own goes in the file, which is then a zip file.
/// </summary>
/// <remarks>
/// Importing makes a new deck, like importing a built-in one. A card whose words the user already has a card for puts
/// that card in the deck as it is, so the deck has every card it was shared with. Log statements include ids and
/// counts only, never a name or a word.
/// </remarks>
public class DeckSharingService(
    FlashCardDbContext dbContext,
    IImageStore imageStore,
    SystemDeckImporter systemDecks,
    ILogger<DeckSharingService> logger)
{
    // The user's deck as a file to share, or null when they have no deck with this id. A picture that's gone from the
    // store is left out.
    public async Task<DeckExport?> ExportAsync(int id, CancellationToken cancellationToken)
    {
        var deck = await dbContext.Decks
            .AsNoTracking()
            .Include(item => item.FlashCards)
            .ThenInclude(card => card.Words)
            .Include(item => item.FlashCards)
            .ThenInclude(card => card.Tags)
            .AsSplitQuery()
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (deck is null)
        {
            logger.LogWarning("Deck {DeckId} not found to export", id);
            return null;
        }

        var cards = deck.FlashCards.OrderBy(card => card.Id).ToList();
        var generated = await GeneratedPictureIdsAsync(cards, cancellationToken);
        var file = new DeckFile { Name = deck.Name, Cards = [] };
        var pictures = new List<(string Path, ReadOnlyMemory<byte> Data)>();

        foreach (var (card, index) in cards.Select((card, index) => (card, index)))
        {
            var fileCard = new DeckFileCard
            {
                Spanish = [.. card.Spanish],
                English = [.. card.English],
                Tags = [.. card.Tags.OrderedByName().Select(tag => tag.Name)]
            };

            if (card.ImageUrl is { } url)
            {
                if (generated.TryGetValue(url, out var pictureId))
                {
                    fileCard.PictureId = pictureId;
                }
                else if (DeckPackage.PicturePath(index + 1, url) is { } path
                    && await imageStore.LoadAsync(url, cancellationToken) is { } data)
                {
                    fileCard.PictureFile = path;
                    pictures.Add((path, data));
                }
            }

            file.Cards.Add(fileCard);
        }

        logger.LogInformation(
            "Exported deck {DeckId} with {Count} flash cards and {PictureCount} pictures of the user's own",
            id,
            cards.Count,
            pictures.Count);

        return pictures.Count == 0
            ? new DeckExport(
                DeckPackage.FileName(deck.Name, "yml"),
                DeckPackage.YamlContentType,
                Encoding.UTF8.GetBytes(DeckPackage.ToYaml(file)))
            : new DeckExport(
                DeckPackage.FileName(deck.Name, "zip"),
                DeckPackage.ZipContentType,
                DeckPackage.ToZip(file, pictures));
    }

    // Makes a new deck from a deck file the user uploaded, with a number after its name if they have a deck with it
    // already. Nothing is imported when anything in the file is wrong.
    public async Task<DeckImportResult> ImportAsync(byte[] data, CancellationToken cancellationToken)
    {
        DeckUpload upload;
        try
        {
            upload = DeckPackage.Read(data);
        }
        catch (InvalidDeckFileException ex)
        {
            logger.LogWarning("Refused a deck file that couldn't be read");
            return new DeckImportResult.Invalid(ex.Message);
        }

        using (upload)
        {
            List<ImportedCard> cards;
            string name;
            try
            {
                (name, cards) = Check(upload);
            }
            catch (InvalidDeckFileException ex)
            {
                logger.LogWarning("Refused a deck file that isn't valid");
                return new DeckImportResult.Invalid(ex.Message);
            }

            return await ImportAsync(name, cards, cancellationToken);
        }
    }

    private async Task<DeckImportResult> ImportAsync(
        string name, List<ImportedCard> cards, CancellationToken cancellationToken)
    {
        var pictureIds = cards.Select(card => card.PictureId).OfType<int>().Distinct().ToList();
        var generated = await dbContext.GeneratedImages
            .AsNoTracking()
            .Where(item => pictureIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => item.ImageUrl, cancellationToken);

        var taken = await TakenWords.LoadAsync(dbContext, exceptCardId: null, cancellationToken);
        var tags = await dbContext.Tags.ToListAsync(cancellationToken);
        var deck = new Deck { Name = await systemDecks.UnusedDeckNameAsync(name, cancellationToken) };
        var existingIds = new HashSet<int>();
        var skipped = 0;
        var missingPictures = 0;
        var uploads = new List<(FlashCard Card, ReadOnlyMemory<byte> Data, string ContentType)>();

        foreach (var item in cards)
        {
            // A word is only ever on one of a user's cards. The card the user has goes in the deck instead, and one
            // that repeats an earlier card in the file is left out.
            if (taken.FirstClash(item.Spanish, item.English) is { } clash)
            {
                if (clash.FlashCardId == 0)
                {
                    skipped++;
                }
                else
                {
                    existingIds.Add(clash.FlashCardId);
                }

                continue;
            }

            var card = new FlashCard
            {
                Tags = item.TagNames.Select(tags.FindOrAdd).OrderedByName(),
                Source = CardSource.Import
            };
            card.SetWords(Language.Spanish, item.Spanish);
            card.SetWords(Language.English, item.English);
            taken.Add(card);

            // A generated picture is shared through the cache, as on any card. One that isn't in it (the file may be
            // from another FlashCardSage site) is left off, unless the file has the picture too.
            if (item.PictureId is { } pictureId && generated.TryGetValue(pictureId, out var url))
            {
                card.ImageUrl = url;
            }
            else if (item.Picture is { } picture)
            {
                uploads.Add((card, picture.Data, picture.ContentType));
            }
            else if (item.PictureId is not null)
            {
                missingPictures++;
            }

            deck.FlashCards.Add(card);
        }

        var newCount = deck.FlashCards.Count;
        if (existingIds.Count > 0)
        {
            deck.FlashCards.AddRange(
                await dbContext.FlashCards.Where(card => existingIds.Contains(card.Id)).ToListAsync(cancellationToken));
        }

        dbContext.Decks.Add(deck);

        // The pictures are the new cards' own, and are removed again if the cards aren't saved.
        var saved = new List<string>();
        try
        {
            foreach (var (card, data, contentType) in uploads)
            {
                card.ImageUrl = await imageStore.SaveAsync(data, contentType, cancellationToken);
                saved.Add(card.ImageUrl);
            }

            if (await dbContext.TrySaveUniqueAsync(CancellationToken.None) is not null)
            {
                logger.LogWarning("Refused to import a deck file over cards saved meanwhile");
                await imageStore.TryDeleteAllAsync(saved, logger, CancellationToken.None);
                return new DeckImportResult.Clash();
            }
        }
        catch
        {
            await imageStore.TryDeleteAllAsync(saved, logger, CancellationToken.None);
            throw;
        }

        logger.LogInformation(
            "Imported a deck file as deck {DeckId} with {Count} new flash cards and {ExistingCount} the user had, skipping {SkippedCount}, with {PictureCount} pictures of its own and {MissingPictureCount} missing",
            deck.Id,
            newCount,
            existingIds.Count,
            skipped,
            uploads.Count,
            missingPictures);

        return new DeckImportResult.Imported(deck, newCount, existingIds.Count, skipped, missingPictures);
    }

    // The deck's name and its cards, checked as cards the user adds are, with the pictures of their own read from the
    // file. Throws an InvalidDeckFileException, whose message is for the user, for the first thing that's wrong.
    private static (string Name, List<ImportedCard> Cards) Check(DeckUpload upload)
    {
        var file = upload.Deck;
        if (file.Version > DeckFile.CurrentVersion)
        {
            throw new InvalidDeckFileException("The deck is from a newer version of FlashCardSage.");
        }

        var name = TextRules.Clean(file.Name);
        if (name.Length == 0)
        {
            throw new InvalidDeckFileException("The deck needs a name.");
        }

        if (name.Length > Deck.MaxNameLength)
        {
            throw new InvalidDeckFileException($"The deck's name can be at most {Deck.MaxNameLength} characters.");
        }

        var fileCards = file.Cards ?? [];
        if (fileCards.Count == 0)
        {
            throw new InvalidDeckFileException("The deck has no cards.");
        }

        if (fileCards.Count > DeckPackage.MaxCards)
        {
            throw new InvalidDeckFileException($"A deck file can have at most {DeckPackage.MaxCards} cards.");
        }

        List<ImportedCard> cards = [.. fileCards.Select((card, index) => CheckCard(upload, card, index + 1))];
        return (name, cards);
    }

    private static ImportedCard CheckCard(DeckUpload upload, DeckFileCard? card, int number)
    {
        if (card is null)
        {
            throw new InvalidDeckFileException($"Card {number} is empty.");
        }

        var errors = new List<KeyValuePair<string, string>>();
        var (spanish, english, tagNames) = FlashCardService.Trim(
            new FlashCardRequest
            {
                Spanish = [.. (card.Spanish ?? []).OfType<string>()],
                English = [.. (card.English ?? []).OfType<string>()],
                Tags = [.. (card.Tags ?? []).OfType<string>()]
            },
            errors);
        if (errors.Count > 0)
        {
            throw new InvalidDeckFileException($"Card {number}: {errors[0].Value}");
        }

        try
        {
            (ReadOnlyMemory<byte> Data, string ContentType)? picture = string.IsNullOrWhiteSpace(card.PictureFile)
                ? null
                : upload.ReadPicture(card.PictureFile.Trim());
            return new ImportedCard(spanish, english, tagNames, card.PictureId, picture);
        }
        catch (InvalidDeckFileException ex)
        {
            throw new InvalidDeckFileException($"Card {number}: {ex.Message}", ex);
        }
    }

    // The ids in the cache of the cards' generated pictures, by their URL. A picture of the user's own isn't in it.
    private async Task<Dictionary<string, int>> GeneratedPictureIdsAsync(
        List<FlashCard> cards, CancellationToken cancellationToken)
    {
        var urls = cards.Select(card => card.ImageUrl).OfType<string>().Distinct(StringComparer.Ordinal).ToList();
        var cached = await dbContext.GeneratedImages
            .AsNoTracking()
            .Where(item => urls.Contains(item.ImageUrl))
            .Select(item => new { item.Id, item.ImageUrl })
            .ToListAsync(cancellationToken);

        return cached
            .GroupBy(item => item.ImageUrl, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.Min(item => item.Id), StringComparer.Ordinal);
    }

    // A card from the file, checked, with its picture of its own if it has one.
    private sealed record ImportedCard(
        List<string> Spanish,
        List<string> English,
        List<string> TagNames,
        int? PictureId,
        (ReadOnlyMemory<byte> Data, string ContentType)? Picture);
}

// A deck written to a file to share, with the name to save it as.
public sealed record DeckExport(string FileName, string ContentType, byte[] Content);
