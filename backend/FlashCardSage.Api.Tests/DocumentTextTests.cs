using System.IO.Compression;
using System.Text;
using FlashCardSage.Api.Documents;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace FlashCardSage.Api.Tests;

public class DocumentTextTests
{
    [Theory]
    [InlineData("cuento.txt")]
    [InlineData("Notas.MD")]
    [InlineData("pelicula.srt")]
    [InlineData("pelicula.vtt")]
    public async Task ReadAsync_ReadsATextFile(string fileName)
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("El niño comió una manzana."));

        var text = await DocumentText.ReadAsync(stream, fileName, 1000, CancellationToken.None);

        Assert.Equal("El niño comió una manzana.", text);
    }

    [Fact]
    public async Task ReadAsync_ReadsATextFileWithAByteOrderMark()
    {
        using var stream = new MemoryStream([.. Encoding.Unicode.GetPreamble(), .. Encoding.Unicode.GetBytes("¿Qué tal?")]);

        var text = await DocumentText.ReadAsync(stream, "hola.txt", 1000, CancellationToken.None);

        Assert.Equal("¿Qué tal?", text);
    }

    [Fact]
    public async Task ReadAsync_ReadsUpToTheMaximumLength()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("abcdefghij"));

        var text = await DocumentText.ReadAsync(stream, "letras.txt", 4, CancellationToken.None);

        Assert.Equal("abcd", text);
    }

    [Fact]
    public async Task ReadAsync_ReadsAWordDocumentsParagraphs()
    {
        using var stream = WordDocument("""
            <w:p><w:r><w:t>El gato</w:t></w:r><w:r><w:t xml:space="preserve"> duerme.</w:t></w:r></w:p>
            <w:p><w:r><w:t>Uno</w:t><w:tab/><w:t>dos</w:t><w:br/><w:t>tres</w:t></w:r></w:p>
            <w:p><w:r><w:delText>borrado</w:delText><w:t/></w:r></w:p>
            """);

        var text = await DocumentText.ReadAsync(stream, "cuento.docx", 1000, CancellationToken.None);

        Assert.Equal("El gato duerme.\nUno\tdos\ntres\n\n", text);
    }

    [Fact]
    public async Task ReadAsync_ReadsAWordDocumentUpToTheMaximumLength()
    {
        using var stream = WordDocument("<w:p><w:r><w:t>abcdefghij</w:t></w:r></w:p><w:p><w:r><w:t>klm</w:t></w:r></w:p>");

        var text = await DocumentText.ReadAsync(stream, "letras.docx", 4, CancellationToken.None);

        Assert.Equal("abcd", text);
    }

    [Fact]
    public async Task ReadAsync_Throws_ForAWordDocumentThatIsNotOne()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("not a zip"));

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            DocumentText.ReadAsync(stream, "cuento.docx", 1000, CancellationToken.None));
    }

    [Fact]
    public async Task ReadAsync_Throws_ForAWordDocumentWithBrokenXml()
    {
        using var stream = WordDocument("<w:p><w:r><w:t>sin cerrar");

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            DocumentText.ReadAsync(stream, "cuento.docx", 1000, CancellationToken.None));
    }

    [Fact]
    public async Task ReadAsync_ReadsAPdfsPages()
    {
        using var stream = Pdf(["El gato duerme.", "El perro corre."], ["Fin."]);

        var text = await DocumentText.ReadAsync(stream, "Cuento.PDF", 1000, CancellationToken.None);

        Assert.Equal("El gato duerme.\nEl perro corre.\nFin.\n", text!.ReplaceLineEndings("\n"));
    }

    [Fact]
    public async Task ReadAsync_ReadsAPdfUpToTheMaximumLength()
    {
        using var stream = Pdf(["abcdefghij"], ["klm"]);

        var text = await DocumentText.ReadAsync(stream, "letras.pdf", 4, CancellationToken.None);

        Assert.Equal("abcd", text);
    }

    [Fact]
    public async Task ReadAsync_Throws_ForAPdfThatIsNotOne()
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("not a pdf"));

        await Assert.ThrowsAsync<InvalidDataException>(() =>
            DocumentText.ReadAsync(stream, "cuento.pdf", 1000, CancellationToken.None));
    }

    [Theory]
    [InlineData("cuento.rtf")]
    [InlineData("foto.png")]
    [InlineData("sin-extension")]
    public async Task ReadAsync_ReturnsNull_ForAnotherKindOfDocument(string fileName)
    {
        using var stream = new MemoryStream(Encoding.UTF8.GetBytes("hola"));

        Assert.Null(await DocumentText.ReadAsync(stream, fileName, 1000, CancellationToken.None));
    }

    // A PDF with a page for each list of lines, written in one of the fonts every PDF reader has.
    private static MemoryStream Pdf(params string[][] pages)
    {
        var builder = new PdfDocumentBuilder();
        var font = builder.AddStandard14Font(Standard14Font.Helvetica);
        foreach (var lines in pages)
        {
            var page = builder.AddPage(PageSize.A4);
            for (var index = 0; index < lines.Length; index++)
            {
                page.AddText(lines[index], 12, new PdfPoint(50, 750 - (index * 20)), font);
            }
        }

        return new MemoryStream(builder.Build());
    }

    // A .docx file with this XML as its body.
    internal static MemoryStream WordDocument(string body)
    {
        var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            using var writer = new StreamWriter(archive.CreateEntry("word/document.xml").Open());
            writer.Write(
                "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>"
                + body
                + "</w:body></w:document>");
        }

        stream.Position = 0;
        return stream;
    }
}
