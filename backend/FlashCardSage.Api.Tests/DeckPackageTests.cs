using System.IO.Compression;
using System.Text;
using FlashCardSage.Api.Sharing;
using FlashCardSage.Api.Tests.TestData;

namespace FlashCardSage.Api.Tests;

public class DeckPackageTests
{
    [Fact]
    public void ToYaml_WritesTheDeckForPeopleToRead_LeavingOutWhatACardHasnt()
    {
        var deck = new DeckFile
        {
            Name = "Lección 3",
            Cards =
            [
                new DeckFileCard { Spanish = ["solo", "únicamente"], English = ["only"], Tags = ["Adverbios"], PictureId = 42 },
                new DeckFileCard { Spanish = ["el niño"], English = ["the boy"], PictureFile = "pictures/2.jpg" }
            ]
        };

        var yaml = DeckPackage.ToYaml(deck);

        Assert.Equal(
            """
            # A FlashCardSage deck. Import it on the Decks page.
            version: 1
            name: Lección 3
            cards:
            - spanish:
              - solo
              - únicamente
              english:
              - only
              tags:
              - Adverbios
              pictureId: 42
            - spanish:
              - el niño
              english:
              - the boy
              pictureFile: pictures/2.jpg

            """.ReplaceLineEndings("\n"),
            yaml);
    }

    [Fact]
    public void Read_ReadsAYamlFile_WithAByteOrderMark_AndWithoutAVersion()
    {
        var yaml = "name: Week 1\ncards:\n- spanish: [gato]\n  english: [cat]\n  somethingNewer: true\n";

        using var upload = DeckPackage.Read([.. Encoding.UTF8.GetPreamble(), .. Encoding.UTF8.GetBytes(yaml)]);

        Assert.Equal(DeckFile.CurrentVersion, upload.Deck.Version);
        Assert.Equal("Week 1", upload.Deck.Name);
        var card = Assert.Single(upload.Deck.Cards!);
        Assert.Equal(["gato"], card!.Spanish!);
        Assert.Equal(["cat"], card.English!);
    }

    [Theory]
    [InlineData("name: [unclosed")]
    [InlineData("just some text")]
    [InlineData("")]
    public void Read_RefusesAFileThatIsntADeck(string content)
    {
        var ex = Assert.Throws<InvalidDeckFileException>(() => DeckPackage.Read(Encoding.UTF8.GetBytes(content)));

        Assert.Equal(DeckPackage.NotADeckMessage, ex.Message);
    }

    [Fact]
    public void Read_FindsTheYamlFileInAFolderOfTheZip_AndItsPicturesFromThere()
    {
        var zip = Zip(
            ("Lesson/lesson.yaml", Encoding.UTF8.GetBytes("name: Lesson\ncards: []\n")),
            ("Lesson/pictures/1.jpg", SampleImages.Jpeg),
            ("__MACOSX/Lesson/._lesson.yaml", [0]));

        using var upload = DeckPackage.Read(zip);

        Assert.Equal("Lesson", upload.Deck.Name);
        var (data, contentType) = upload.ReadPicture("pictures\\1.jpg");
        Assert.Equal(SampleImages.Jpeg, data.ToArray());
        Assert.Equal("image/jpeg", contentType);
        Assert.Equal(
            "Its picture pictures/2.jpg isn't in the zip file.",
            Assert.Throws<InvalidDeckFileException>(() => upload.ReadPicture("pictures/2.jpg")).Message);
    }

    [Fact]
    public void ReadPicture_RefusesAPictureThatIsntWhatItsNameSays()
    {
        using var upload = DeckPackage.Read(Zip(
            ("deck.yml", Encoding.UTF8.GetBytes("name: Lesson\n")),
            ("pictures/1.png", SampleImages.Jpeg),
            ("pictures/1.gif", SampleImages.Jpeg)));

        Assert.Equal(
            "The picture isn't the kind of image its content type says.",
            Assert.Throws<InvalidDeckFileException>(() => upload.ReadPicture("pictures/1.png")).Message);
        Assert.Equal(
            "Its picture must be a JPEG, PNG or WebP.",
            Assert.Throws<InvalidDeckFileException>(() => upload.ReadPicture("pictures/1.gif")).Message);
    }

    [Fact]
    public void ReadPicture_SaysToImportTheZipFile_ForAYamlFileOnItsOwn()
    {
        using var upload = DeckPackage.Read(Encoding.UTF8.GetBytes("name: Lesson\n"));

        Assert.Equal(
            "Its picture pictures/1.jpg is only in the deck's zip file. Import that instead.",
            Assert.Throws<InvalidDeckFileException>(() => upload.ReadPicture("pictures/1.jpg")).Message);
    }

    [Fact]
    public void Read_RefusesAZipWithoutOneYamlFile()
    {
        var none = Zip(("pictures/1.jpg", SampleImages.Jpeg));
        var two = Zip(("a.yml", "name: A"u8.ToArray()), ("b.yml", "name: B"u8.ToArray()));

        Assert.Equal(
            "The zip file needs to have one deck's .yml file in it.",
            Assert.Throws<InvalidDeckFileException>(() => DeckPackage.Read(none)).Message);
        Assert.Equal(
            "The zip file needs to have one deck's .yml file in it.",
            Assert.Throws<InvalidDeckFileException>(() => DeckPackage.Read(two)).Message);
    }

    [Fact]
    public void Read_RefusesABrokenZip()
    {
        Assert.Equal(
            "The zip file couldn't be read.",
            Assert.Throws<InvalidDeckFileException>(() => DeckPackage.Read("PK not really"u8.ToArray())).Message);
    }

    [Fact]
    public void ToZip_WritesTheYamlFileAndThePictures_WhichReadBack()
    {
        var deck = new DeckFile
        {
            Name = "Week 1",
            Cards = [new DeckFileCard { Spanish = ["gato"], English = ["cat"], PictureFile = "pictures/1.png" }]
        };

        using var upload = DeckPackage.Read(DeckPackage.ToZip(deck, [("pictures/1.png", SampleImages.Png)]));

        Assert.Equal("pictures/1.png", Assert.Single(upload.Deck.Cards!)!.PictureFile);
        Assert.Equal(SampleImages.Png, upload.ReadPicture("pictures/1.png").Data.ToArray());
    }

    [Theory]
    [InlineData("Week 1", "Week 1.yml")]
    [InlineData("A/B: C?", "A-B- C-.yml")]
    [InlineData("Lesson...", "Lesson.yml")]
    [InlineData("***", "---.yml")]
    [InlineData(" ", "deck.yml")]
    public void FileName_MakesTheDeckNameSafeForAFile(string name, string expected)
    {
        Assert.Equal(expected, DeckPackage.FileName(name, "yml"));
    }

    [Theory]
    [InlineData("https://images.test/card-images/abc.JPG", "pictures/3.jpg")]
    [InlineData("https://images.test/card-images/abc.webp", "pictures/3.webp")]
    [InlineData("https://images.test/card-images/abc.mp3", null)]
    [InlineData("not a url", null)]
    public void PicturePath_NamesThePictureByItsCardAndKind(string url, string? expected)
    {
        Assert.Equal(expected, DeckPackage.PicturePath(3, url));
    }

    private static byte[] Zip(params (string Path, byte[] Data)[] entries)
    {
        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            foreach (var (path, data) in entries)
            {
                using var stream = archive.CreateEntry(path).Open();
                stream.Write(data);
            }
        }

        return output.ToArray();
    }
}
