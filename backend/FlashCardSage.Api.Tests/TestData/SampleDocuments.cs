using System.IO.Compression;
using UglyToad.PdfPig.Content;
using UglyToad.PdfPig.Core;
using UglyToad.PdfPig.Fonts.Standard14Fonts;
using UglyToad.PdfPig.Writer;

namespace FlashCardSage.Api.Tests.TestData;

internal static class SampleDocuments
{
    // A .docx file with this XML as its body.
    public static MemoryStream WordDocument(string body)
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

    // A PDF with a page for each list of lines, written in one of the fonts every PDF reader has.
    public static MemoryStream Pdf(params string[][] pages)
    {
        using var builder = new PdfDocumentBuilder();
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
}
