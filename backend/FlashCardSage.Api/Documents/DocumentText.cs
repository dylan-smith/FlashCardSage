using System.IO.Compression;
using System.Text;
using System.Xml;

namespace FlashCardSage.Api.Documents;

// Reads the text of a document the user uploads to scan for cards: a text file, such as notes or a film's subtitles,
// or a Word document. Only as much as is needed is read, so a huge document (or a zip bomb posing as a Word document)
// is never read in full.
public static class DocumentText
{
    // The kinds of documents that can be read, by their file name's extension, since the type a browser sends for a
    // file depends on what's installed on the user's computer.
    public static readonly IReadOnlyList<string> Extensions = [".txt", ".md", ".srt", ".vtt", ".docx"];

    private const string WordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

    // The document's text, at most maxLength characters of it, or null for a kind of document that can't be read.
    // Throws InvalidDataException for a Word document that isn't one.
    public static async Task<string?> ReadAsync(
        Stream stream, string fileName, int maxLength, CancellationToken cancellationToken)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        return !Extensions.Contains(extension) ? null
            : extension == ".docx" ? await ReadWordAsync(stream, maxLength, cancellationToken)
            : await ReadTextAsync(stream, maxLength, cancellationToken);
    }

    // UTF-8 unless a byte order mark says otherwise.
    private static async Task<string> ReadTextAsync(Stream stream, int maxLength, CancellationToken cancellationToken)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var buffer = new char[maxLength];
        var length = await reader.ReadBlockAsync(buffer, cancellationToken);
        return new string(buffer, 0, length);
    }

    // The text of the document's body, a line per paragraph. A .docx file is a zip of XML files, and the body is
    // word/document.xml, where the text is in w:t elements.
    private static async Task<string> ReadWordAsync(Stream stream, int maxLength, CancellationToken cancellationToken)
    {
        // Copied to memory first, since an uploaded file's stream fails a zip's seeks with exceptions of its own when
        // the file is too short to be one. The upload's size is limited, so this is too.
        using var copy = new MemoryStream();
        await stream.CopyToAsync(copy, cancellationToken);
        copy.Position = 0;

        try
        {
            await using var archive = await ZipArchive.CreateAsync(
                copy, ZipArchiveMode.Read, leaveOpen: true, entryNameEncoding: null, cancellationToken);
            var entry = archive.GetEntry("word/document.xml")
                ?? throw new InvalidDataException("The document has no body.");
            await using var xml = await entry.OpenAsync(cancellationToken);
            using var reader = XmlReader.Create(
                xml, new XmlReaderSettings { Async = true, DtdProcessing = DtdProcessing.Prohibit });

            var text = new StringBuilder();
            var inText = false;
            while (text.Length < maxLength && await reader.ReadAsync())
            {
                if (reader.NodeType is XmlNodeType.Text or XmlNodeType.Whitespace or XmlNodeType.SignificantWhitespace)
                {
                    if (inText)
                    {
                        text.Append(reader.Value);
                    }
                    continue;
                }

                if (reader.NamespaceURI != WordNamespace)
                {
                    continue;
                }

                if (reader.NodeType == XmlNodeType.Element)
                {
                    switch (reader.LocalName)
                    {
                        case "t":
                            inText = !reader.IsEmptyElement;
                            break;
                        case "tab":
                            text.Append('\t');
                            break;
                        case "br" or "cr":
                            text.Append('\n');
                            break;
                    }
                }
                else if (reader.NodeType == XmlNodeType.EndElement)
                {
                    switch (reader.LocalName)
                    {
                        case "t":
                            inText = false;
                            break;
                        case "p":
                            text.Append('\n');
                            break;
                    }
                }
            }

            return text.Length > maxLength ? text.ToString(0, maxLength) : text.ToString();
        }
        catch (XmlException ex)
        {
            throw new InvalidDataException("The document's body couldn't be read.", ex);
        }
    }
}
