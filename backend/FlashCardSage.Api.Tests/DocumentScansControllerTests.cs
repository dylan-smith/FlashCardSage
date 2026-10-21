using System.Net;
using System.Net.Http.Headers;
using System.Text;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Tests.Fakes;
using FlashCardSage.Api.Tests.TestData;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class DocumentScansControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
    // The app with no key for the service, so it's off.
    private static readonly Dictionary<string, string> Settings = new() { ["CardSuggestions:Key"] = "" };

    // The uploads' streams, which a FormFile doesn't dispose, disposed once the test is done.
    private readonly List<MemoryStream> streams = [];

    public void Dispose()
    {
        streams.ForEach(stream => stream.Dispose());
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Scan_ReturnsTheCandidates_LeavingOutCardsTheUserHas()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var scanner = new FakeScanner
        {
            Result = [new(" el perro ", "the dog "), new("El Gato", "the kitty"), new("el pez", "the fish"), new("", "x")]
        };
        await using var dbContext = TestDb.Create(databaseName);

        var result = await CreateController(dbContext, scanner).Scan(File("cuento.txt", "Un gato y un perro."), CancellationToken.None);

        var response = ActionResultAssert.Ok<DocumentScanResponse>(result.Result);
        Assert.Equal([new("el perro", "the dog"), new("el pez", "the fish")], response.Candidates);
        Assert.False(response.Truncated);
        Assert.Equal("Un gato y un perro.", scanner.Text);
        Assert.Equal(DocumentScansController.MaxCandidates + 10, scanner.Count);
    }

    [Fact]
    public async Task Scan_TellsTheScannerOnlyAboutTheUsersCardsForWordsInTheDocument()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedCardsAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("comer", "to eat"), ("la casa", "the house"), ("Y", "and"));
        await TestDb.SeedCardsAsync(databaseName, TestDb.OtherUserId, ("perro", "dog"));
        var scanner = new FakeScanner();
        await using var dbContext = TestDb.Create(databaseName);

        await CreateController(dbContext, scanner).Scan(
            File("cuento.txt", "Un Gato y un perro van a comer."), CancellationToken.None);

        Assert.Equal(["el gato", "comer", "Y"], scanner.Cards!.Select(card => card.Spanish.Single()));
    }

    [Fact]
    public async Task Scan_ReturnsAHundredCandidatesAtMost()
    {
        var scanner = new FakeScanner
        {
            Result = Enumerable.Range(1, 110).Select(i => new CardSuggestion($"es {i}", $"en {i}")).ToList()
        };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, scanner).Scan(
            File("cuento.txt", "Hola."), CancellationToken.None);

        var response = ActionResultAssert.Ok<DocumentScanResponse>(result.Result);
        Assert.Equal(DocumentScansController.MaxCandidates, response.Candidates.Count);
        Assert.Equal("es 100", response.Candidates[^1].Spanish);
    }

    [Fact]
    public async Task Scan_ScansTheStartOfALongDocument()
    {
        var scanner = new FakeScanner();
        var text = new string('a', DocumentScansController.MaxCharacters) + "b";
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, scanner).Scan(
            File("largo.txt", text), CancellationToken.None);

        var response = ActionResultAssert.Ok<DocumentScanResponse>(result.Result);
        Assert.True(response.Truncated);
        Assert.Equal(text[..^1], scanner.Text);
    }

    [Fact]
    public async Task Scan_ScansAWordDocument()
    {
        var scanner = new FakeScanner();
        using var stream = SampleDocuments.WordDocument("<w:p><w:r><w:t>Buenos días.</w:t></w:r></w:p>");
        await using var dbContext = TestDb.Create();

        await CreateController(dbContext, scanner).Scan(
            new FormFile(stream, 0, stream.Length, "file", "cuento.docx"), CancellationToken.None);

        Assert.Equal("Buenos días.\n", scanner.Text);
    }

    [Theory]
    [InlineData("cuento.rtf", "hola", "Choose a .txt, .md, .srt, .vtt, .docx or .pdf document.")]
    [InlineData("roto.pdf", "not a pdf", "The document couldn't be read.")]
    [InlineData("vacio.txt", " \n ", "The document has no text to scan.")]
    [InlineData("roto.docx", "not a zip", "The document couldn't be read.")]
    public async Task Scan_ReturnsValidationProblem_ForADocumentItCantScan(string fileName, string content, string message)
    {
        var scanner = new FakeScanner();
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, scanner).Scan(
            File(fileName, content), CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "file", message);
        Assert.Null(scanner.Text);
    }

    [Fact]
    public async Task Scan_SaysAPdfWithoutTextMayBeScannedPictures()
    {
        // A page with nothing written on it.
        using var stream = SampleDocuments.Pdf([[]]);
        var scanner = new FakeScanner();
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, scanner).Scan(
            new FormFile(stream, 0, stream.Length, "file", "escaneado.pdf"), CancellationToken.None);

        ActionResultAssert.ValidationProblem(result.Result, "file", DocumentScansController.NoTextInPdfMessage);
        Assert.Null(scanner.Text);
    }

    [Fact]
    public async Task Scan_ReturnsServiceUnavailable_WhenScanningIsOff()
    {
        var scanner = new FakeScanner { IsAvailable = false };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, scanner).Scan(
            File("cuento.txt", "Hola."), CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status503ServiceUnavailable);
        Assert.Null(scanner.Text);
    }

    [Theory]
    [InlineData(typeof(HttpRequestException))]
    [InlineData(typeof(TaskCanceledException))]
    public async Task Scan_ReturnsBadGateway_WhenTheScannerFailsOrTimesOut(Type failure)
    {
        var scanner = new FakeScanner { Failure = (Exception)Activator.CreateInstance(failure)! };
        await using var dbContext = TestDb.Create();

        var result = await CreateController(dbContext, scanner).Scan(
            File("cuento.txt", "Hola."), CancellationToken.None);

        ActionResultAssert.Problem(result.Result, StatusCodes.Status502BadGateway);
    }

    [Fact]
    public async Task Scan_RequiresSignIn()
    {
        using var client = TestApp.CreateSignedOutClient(factory, Settings);

        var response = await client.PostAsync("/api/document-scans", Upload());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Scan_IsUnavailable_WithoutAnApiKey()
    {
        using var client = TestApp.CreateSignedInClient(factory, settings: Settings);

        var response = await client.PostAsync("/api/document-scans", Upload());

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    private FormFile File(string fileName, string content)
    {
        var stream = new MemoryStream(Encoding.UTF8.GetBytes(content));
        streams.Add(stream);
        return new FormFile(stream, 0, stream.Length, "file", fileName);
    }

    // A text document, as the page uploads it.
    private static MultipartFormDataContent Upload()
    {
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes("Hola."));
        file.Headers.ContentType = new MediaTypeHeaderValue("text/plain");
        return new MultipartFormDataContent { { file, "file", "cuento.txt" } };
    }

    private static DocumentScansController CreateController(FlashCardDbContext dbContext, IDocumentScanner scanner)
    {
        return new DocumentScansController(
            new FlashCardService(dbContext, new FakeImageStore(), NullLogger<FlashCardService>.Instance),
            scanner,
            NullLogger<DocumentScansController>.Instance);
    }

    private sealed class FakeScanner : IDocumentScanner
    {
        public bool IsAvailable { get; init; } = true;

        public IReadOnlyList<CardSuggestion> Result { get; init; } = [];

        public Exception? Failure { get; init; }

        public string? Text { get; private set; }

        public IReadOnlyList<FlashCard>? Cards { get; private set; }

        public int? Count { get; private set; }

        public Task<IReadOnlyList<CardSuggestion>> ScanAsync(
            string text, IReadOnlyList<FlashCard> cards, int count, CancellationToken cancellationToken)
        {
            Text = text;
            Cards = cards;
            Count = count;
            return Failure is null ? Task.FromResult(Result) : Task.FromException<IReadOnlyList<CardSuggestion>>(Failure);
        }
    }
}
