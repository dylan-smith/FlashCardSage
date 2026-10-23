using System.IO.Compression;
using System.Text;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Sharing;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Tests;

// Exporting a deck to a file and importing one, through DecksController.
public sealed class DeckSharingTests : IDisposable
{
    private readonly List<MemoryStream> streams = [];

    public void Dispose()
    {
        streams.ForEach(stream => stream.Dispose());
    }

    [Fact]
    public async Task Export_ReturnsAYamlFile_WithGeneratedPicturesByTheirIdInTheCache()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName);
        var cached = new CachedImage { PromptHash = "hash", ImageUrl = "https://images.test/card-images/cat.jpg" };
        dbContext.GeneratedImages.Add(cached);
        var cat = TestDb.Card("el gato", "the cat", ["Animals", "Week 1"], cached.ImageUrl);
        var dog = TestDb.Card("el perro", "the dog");
        dbContext.Decks.Add(new Deck { Name = "Week 1", FlashCards = [cat, dog] });
        await dbContext.SaveChangesAsync();
        var deckId = await dbContext.Decks.Select(deck => deck.Id).SingleAsync();

        var file = Assert.IsType<FileContentResult>(
            await DecksControllerTests.CreateController(dbContext).Export(deckId, CancellationToken.None));

        Assert.Equal(DeckPackage.YamlContentType, file.ContentType);
        Assert.Equal("Week 1.yml", file.FileDownloadName);
        using var upload = DeckPackage.Read(file.FileContents);
        Assert.Equal("Week 1", upload.Deck.Name);
        var cards = upload.Deck.Cards!.Select(card => card!).ToList();
        Assert.Equal(["el gato"], cards[0].Spanish!);
        Assert.Equal(["Animals", "Week 1"], cards[0].Tags!);
        Assert.Equal(cached.Id, cards[0].PictureId);
        Assert.Null(cards[1].PictureId);
        Assert.Null(cards[1].PictureFile);
    }

    [Fact]
    public async Task Export_ReturnsAZipFile_WithThePicturesOfTheUsersOwn_LeavingOutOnesThatAreGone()
    {
        var databaseName = TestDb.NewDatabaseName();
        var store = new FakeImageStore();
        var photo = await store.SaveAsync(SampleImages.Jpeg, "image/jpeg", CancellationToken.None);
        await using var dbContext = TestDb.Create(databaseName);
        var cat = TestDb.Card("el gato", "the cat", imageUrl: photo);
        var dog = TestDb.Card("el perro", "the dog", imageUrl: "https://images.test/card-images/gone.jpg");
        dbContext.Decks.Add(new Deck { Name = "Pets", FlashCards = [cat, dog] });
        await dbContext.SaveChangesAsync();
        var deckId = await dbContext.Decks.Select(deck => deck.Id).SingleAsync();

        var file = Assert.IsType<FileContentResult>(
            await DecksControllerTests.CreateController(dbContext, store).Export(deckId, CancellationToken.None));

        Assert.Equal(DeckPackage.ZipContentType, file.ContentType);
        Assert.Equal("Pets.zip", file.FileDownloadName);
        using var archive = new ZipArchive(new MemoryStream(file.FileContents));
        Assert.Equal(["deck.yml", "pictures/1.jpg"], archive.Entries.Select(entry => entry.FullName));
        using var upload = DeckPackage.Read(file.FileContents);
        var cards = upload.Deck.Cards!.Select(card => card!).ToList();
        Assert.Equal("pictures/1.jpg", cards[0].PictureFile);
        Assert.Equal(SampleImages.Jpeg, upload.ReadPicture("pictures/1.jpg").Data.ToArray());
        Assert.Null(cards[1].PictureFile);
    }

    [Fact]
    public async Task Export_ReturnsNotFound_ForAnotherUsersDeck()
    {
        var databaseName = TestDb.NewDatabaseName();
        var other = new Deck { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Decks.Add(other));
        await using var dbContext = TestDb.Create(databaseName);

        var result = await DecksControllerTests.CreateController(dbContext).Export(other.Id, CancellationToken.None);

        Assert.IsType<NotFoundResult>(result);
    }

    // A teacher's deck, exported and imported by a student, who gets copies of the cards, the generated picture by the
    // same URL in the cache, and a copy of the teacher's photo of their own.
    [Fact]
    public async Task Import_CopiesAnExportedDeck_WithItsTagsAndPictures()
    {
        var databaseName = TestDb.NewDatabaseName();
        var store = new FakeImageStore();
        var photo = await store.SaveAsync(SampleImages.Jpeg, "image/jpeg", CancellationToken.None);
        byte[] exported;
        await using (var teacher = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var cached = new CachedImage { PromptHash = "hash", ImageUrl = "https://images.test/card-images/cat.jpg" };
            teacher.GeneratedImages.Add(cached);
            var cat = TestDb.Card("el gato", "the cat", ["Animals"], cached.ImageUrl);
            var dog = TestDb.Card("el perro", "the dog", ["Animals"], photo);
            teacher.Decks.Add(new Deck { Name = "Lesson 3", FlashCards = [cat, dog] });
            await teacher.SaveChangesAsync();
            var deckId = await teacher.Decks.Select(deck => deck.Id).SingleAsync();
            exported = Assert.IsType<FileContentResult>(
                await DecksControllerTests.CreateController(teacher, store).Export(deckId, CancellationToken.None))
                .FileContents;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var result = await DecksControllerTests.CreateController(dbContext, store)
            .Import(Upload("Lesson 3.zip", exported), CancellationToken.None);

        var response = ActionResultAssert.Created<DeckImportResponse>(result.Result);
        Assert.Equal(("Lesson 3", 2, 0, 0, 0), (response.Deck.Name, response.ImportedCount, response.ExistingCount, response.SkippedCount, response.MissingPictureCount));
        var cards = await dbContext.FlashCards.WithWordsAndTags().OrderBy(card => card.Id).ToListAsync();
        Assert.Equal(response.Deck.FlashCardIds, cards.Select(card => card.Id));
        Assert.Equal(["el gato", "el perro"], cards.Select(card => card.Spanish.Single()));
        Assert.All(cards, card => Assert.Equal(CardSource.Import, card.Source));
        Assert.All(cards, card => Assert.Equal("Animals", Assert.Single(card.Tags).Name));
        Assert.Single(await dbContext.Tags.ToListAsync());
        Assert.Equal("https://images.test/card-images/cat.jpg", cards[0].ImageUrl);
        Assert.NotEqual(photo, cards[1].ImageUrl);
        Assert.Equal(SampleImages.Jpeg, store.Saved.Single(item => item.Url == cards[1].ImageUrl).Data);
    }

    [Fact]
    public async Task Import_PutsTheUsersOwnCardsInTheDeck_AndNumbersANameTheyHave()
    {
        var databaseName = TestDb.NewDatabaseName();
        await using var dbContext = TestDb.Create(databaseName);
        var mine = await TestDb.AddCardAsync(dbContext, TestDb.Card("EL GATO", "the kitty"));
        dbContext.Decks.Add(new Deck { Name = "lesson 3" });
        await dbContext.SaveChangesAsync();
        var yaml = """
            name: Lesson 3
            cards:
            - spanish: [el gato]
              english: [the cat]
            - spanish: [el perro]
              english: [the dog]
              pictureId: 999
            - spanish: [el perro, el can]
              english: [the hound]
            """;

        var result = await DecksControllerTests.CreateController(dbContext)
            .Import(Upload("lesson.yml", Encoding.UTF8.GetBytes(yaml)), CancellationToken.None);

        var response = ActionResultAssert.Created<DeckImportResponse>(result.Result);
        Assert.Equal(("Lesson 3 (2)", 1, 1, 1, 1), (response.Deck.Name, response.ImportedCount, response.ExistingCount, response.SkippedCount, response.MissingPictureCount));
        Assert.Contains(mine.Id, response.Deck.FlashCardIds);
        Assert.Equal(2, response.Deck.FlashCardIds.Count);
        var mineNow = await dbContext.FlashCards.WithWords().SingleAsync(card => card.Id == mine.Id);
        Assert.Equal(["the kitty"], mineNow.English);
        Assert.Null((await dbContext.FlashCards.SingleAsync(card => card.Id != mine.Id)).ImageUrl);
    }

    [Theory]
    [InlineData("cards:\n- spanish: [gato]\n  english: [cat]\n", "The deck needs a name.")]
    [InlineData("name: Empty\n", "The deck has no cards.")]
    [InlineData("version: 2\nname: Future\n", "The deck is from a newer version of FlashCardSage.")]
    [InlineData("name: Week 1\ncards:\n- spanish: [gato]\n  english: [cat]\n- spanish: [perro]\n", "Card 2: English is required.")]
    [InlineData("name: Week 1\ncards:\n- spanish: [gato]\n  english: [cat]\n-\n", "Card 2 is empty.")]
    [InlineData(
        "name: Week 1\ncards:\n- spanish: [gato]\n  english: [cat]\n  pictureFile: pictures/1.jpg\n",
        "Card 1: Its picture pictures/1.jpg is only in the deck's zip file. Import that instead.")]
    [InlineData("not: [a deck", DeckPackage.NotADeckMessage)]
    public async Task Import_RefusesAFileThatIsntValid_ImportingNothing(string yaml, string message)
    {
        await using var dbContext = TestDb.Create();

        var result = await DecksControllerTests.CreateController(dbContext)
            .Import(Upload("deck.yml", Encoding.UTF8.GetBytes(yaml)), CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "file", message);
        Assert.False(await dbContext.Decks.AnyAsync());
        Assert.False(await dbContext.FlashCards.AnyAsync());
    }

    [Fact]
    public async Task Import_RefusesTooManyCards()
    {
        await using var dbContext = TestDb.Create();
        var yaml = new StringBuilder("name: Big\ncards:\n");
        for (var number = 0; number <= DeckPackage.MaxCards; number++)
        {
            yaml.Append(System.Globalization.CultureInfo.InvariantCulture, $"- spanish: [s{number}]\n  english: [e{number}]\n");
        }

        var result = await DecksControllerTests.CreateController(dbContext)
            .Import(Upload("deck.yml", Encoding.UTF8.GetBytes(yaml.ToString())), CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "file", $"A deck file can have at most {DeckPackage.MaxCards} cards.");
    }

    [Fact]
    public async Task Import_ReturnsAClash_AndRemovesThePicturesItSaved_WhenAUniqueIndexFails()
    {
        var store = new FakeImageStore();
        await using var dbContext = TestDb.Create(interceptors: FailingSaveInterceptor.DuplicateKey("FlashCardWords"));
        var zip = DeckPackage.ToZip(
            new DeckFile
            {
                Name = "Pets",
                Cards = [new DeckFileCard { Spanish = ["gato"], English = ["cat"], PictureFile = "pictures/1.png" }]
            },
            [("pictures/1.png", SampleImages.Png)]);

        var result = await DecksControllerTests.CreateController(dbContext, store)
            .Import(Upload("pets.zip", zip), CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status409Conflict, DecksController.ImportClashMessage);
        Assert.Equal([Assert.Single(store.Saved).Url], store.Deleted);
    }

    private FormFile Upload(string fileName, byte[] content)
    {
        var stream = new MemoryStream(content);
        streams.Add(stream);
        return new FormFile(stream, 0, stream.Length, "file", fileName);
    }
}
