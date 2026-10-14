using System.Net;
using System.Net.Http.Headers;
using System.Text;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Writer;

namespace FlashCardSage.Api.Tests;

public class DocumentScansControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>, IDisposable
{
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
        var databaseName = Guid.NewGuid().ToString();
        await SeedAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var scanner = new FakeScanner
        {
            Result = [new(" el perro ", "the dog "), new("El Gato", "the kitty"), new("el pez", "the fish"), new("", "x")]
        };

        var result = await CreateController(databaseName, scanner).Scan(File("cuento.txt", "Un gato y un perro."), CancellationToken.None);

        var response = Assert.IsType<DocumentScanResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal([new("el perro", "the dog"), new("el pez", "the fish")], response.Candidates);
        Assert.False(response.Truncated);
        Assert.Equal("Un gato y un perro.", scanner.Text);
        Assert.Equal(DocumentScansController.MaxCandidates + 10, scanner.Count);
    }

    [Fact]
    public async Task Scan_TellsTheScannerOnlyAboutTheUsersCardsForWordsInTheDocument()
    {
        var databaseName = Guid.NewGuid().ToString();
        await SeedAsync(
            databaseName, TestDb.UserId, ("el gato", "the cat"), ("comer", "to eat"), ("la casa", "the house"), ("Y", "and"));
        await SeedAsync(databaseName, TestDb.OtherUserId, ("perro", "dog"));
        var scanner = new FakeScanner();

        await CreateController(databaseName, scanner).Scan(
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

        var result = await CreateController(Guid.NewGuid().ToString(), scanner).Scan(
            File("cuento.txt", "Hola."), CancellationToken.None);

        var response = Assert.IsType<DocumentScanResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(DocumentScansController.MaxCandidates, response.Candidates.Count);
        Assert.Equal("es 100", response.Candidates[^1].Spanish);
    }

    [Fact]
    public async Task Scan_ScansTheStartOfALongDocument()
    {
        var scanner = new FakeScanner();
        var text = new string('a', DocumentScansController.MaxCharacters) + "b";

        var result = await CreateController(Guid.NewGuid().ToString(), scanner).Scan(
            File("largo.txt", text), CancellationToken.None);

        var response = Assert.IsType<DocumentScanResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.True(response.Truncated);
        Assert.Equal(text[..^1], scanner.Text);
    }

    [Fact]
    public async Task Scan_ScansAWordDocument()
    {
        var scanner = new FakeScanner();
        using var stream = DocumentTextTests.WordDocument("<w:p><w:r><w:t>Buenos días.</w:t></w:r></w:p>");

        await CreateController(Guid.NewGuid().ToString(), scanner).Scan(
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

        var result = await CreateController(Guid.NewGuid().ToString(), scanner).Scan(
            File(fileName, content), CancellationToken.None);

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal([message], problem.Errors["file"]);
        Assert.Null(scanner.Text);
    }

    [Fact]
    public async Task Scan_SaysAPdfWithoutTextMayBeScannedPictures()
    {
        using var builder = new PdfDocumentBuilder();
        builder.AddPage(PageSize.A4);
        using var stream = new MemoryStream(builder.Build());
        var scanner = new FakeScanner();

        var result = await CreateController(Guid.NewGuid().ToString(), scanner).Scan(
            new FormFile(stream, 0, stream.Length, "file", "escaneado.pdf"), CancellationToken.None);

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal([DocumentScansController.NoTextInPdfMessage], problem.Errors["file"]);
        Assert.Null(scanner.Text);
    }

    [Fact]
    public async Task Scan_ReturnsServiceUnavailable_WhenScanningIsOff()
    {
        var scanner = new FakeScanner { IsAvailable = false };

        var result = await CreateController(Guid.NewGuid().ToString(), scanner).Scan(
            File("cuento.txt", "Hola."), CancellationToken.None);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Null(scanner.Text);
    }

    [Theory]
    [InlineData(typeof(HttpRequestException))]
    [InlineData(typeof(TaskCanceledException))]
    public async Task Scan_ReturnsBadGateway_WhenTheScannerFailsOrTimesOut(Type failure)
    {
        var scanner = new FakeScanner { Failure = (Exception)Activator.CreateInstance(failure)! };

        var result = await CreateController(Guid.NewGuid().ToString(), scanner).Scan(
            File("cuento.txt", "Hola."), CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Scan_RequiresSignIn()
    {
        using var client = CreateClient(signedIn: false);

        var response = await client.PostAsync("/api/document-scans", Upload());

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Scan_IsUnavailable_WithoutAnApiKey()
    {
        using var client = CreateClient(signedIn: true);

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

    private static async Task SeedAsync(string databaseName, int userId, params (string Spanish, string English)[] cards)
    {
        await using var dbContext = TestDb.Create(databaseName, userId);
        dbContext.FlashCards.AddRange(cards.Select(card => new FlashCard { Words = TestDb.Words(card.Spanish, card.English) }));
        await dbContext.SaveChangesAsync();
    }

    private static DocumentScansController CreateController(string databaseName, IDocumentScanner scanner)
    {
        return new DocumentScansController(
            TestDb.Create(databaseName), scanner, NullLogger<DocumentScansController>.Instance);
    }

    private HttpClient CreateClient(bool signedIn)
    {
        // Development uses the in-memory database and allows test sign-in, so the app starts without SQL Server.
        var client = factory
            .WithWebHostBuilder(builder => builder
                .UseEnvironment("Development")
                .UseSetting("Authentication:AllowTestSignIn", "true")
                .UseSetting("CardSuggestions:Key", ""))
            .CreateClient();
        if (signedIn)
        {
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", $"test:Scans {Guid.NewGuid()}");
        }

        return client;
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
