using System.IO.Compression;
using System.Text;
using YamlDotNet.Core;
using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace FlashCardSage.Api.Sharing;

// How a deck is written to a file to share and read back from one. A deck whose cards have only generated pictures,
// or none, is a YAML file (see DeckFile). One with pictures of the user's own is a zip file holding the YAML file and
// the pictures, under pictures/, which the YAML file names.
public static class DeckPackage
{
    public const string YamlContentType = "application/yaml";

    public const string ZipContentType = "application/zip";

    // The YAML file's name in a zip file DeckPackage writes. One it reads can have any name and folder.
    public const string YamlFileName = "deck.yml";

    public const string PicturesFolder = "pictures";

    // The most cards a deck file can have.
    public const int MaxCards = 1000;

    // Room for the most cards, each with long words.
    public const int MaxYamlBytes = 2 * 1024 * 1024;

    // The biggest file that can be imported, which is also the most its pictures can come to once they're unzipped,
    // since pictures are compressed already, so a zip of them is about their size.
    public const int MaxFileBytes = 50 * 1024 * 1024;

    public const string NotADeckMessage = "The file isn't a FlashCardSage deck.";

    // At the top of every YAML file, for anyone who opens it.
    private const string Header = "# A FlashCardSage deck. Import it on the Decks page.\n";

    // The kinds of picture a card can have, by the extension they're named with.
    private static readonly Dictionary<string, string> PictureTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg",
        [".jpeg"] = "image/jpeg",
        [".png"] = "image/png",
        [".webp"] = "image/webp"
    };

    // The characters a file name can't have somewhere, which become dashes.
    private static readonly char[] FileNameCharacters = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

    // Leaves out what a card doesn't have, such as a picture, so a file stays short to read. The lines end the same
    // whichever OS the API runs on.
    private static readonly ISerializer Serializer = new SerializerBuilder()
        .WithNewLine("\n")
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .ConfigureDefaultValuesHandling(DefaultValuesHandling.OmitNull | DefaultValuesHandling.OmitEmptyCollections)
        .Build();

    // Ignores what it doesn't know, so a file from a newer version with something extra is still read.
    private static readonly IDeserializer Deserializer = new DeserializerBuilder()
        .WithNamingConvention(CamelCaseNamingConvention.Instance)
        .IgnoreUnmatchedProperties()
        .Build();

    public static string ToYaml(DeckFile deck)
    {
        return Header + Serializer.Serialize(deck);
    }

    // A zip file of the deck's YAML file and the pictures it names, by their paths.
    public static byte[] ToZip(DeckFile deck, IEnumerable<(string Path, ReadOnlyMemory<byte> Data)> pictures)
    {
        ArgumentNullException.ThrowIfNull(pictures);

        using var output = new MemoryStream();
        using (var archive = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
        {
            var yaml = archive.CreateEntry(YamlFileName, CompressionLevel.Optimal);
            using (var stream = yaml.Open())
            {
                stream.Write(Encoding.UTF8.GetBytes(ToYaml(deck)));
            }

            // Pictures are compressed already.
            foreach (var (path, data) in pictures)
            {
                using var stream = archive.CreateEntry(path, CompressionLevel.NoCompression).Open();
                stream.Write(data.Span);
            }
        }

        return output.ToArray();
    }

    // Where the card numbered this (from 1) keeps a picture with this URL, by the URL's extension, or null when it isn't
    // a kind of picture a card can have.
    public static string? PicturePath(int number, string url)
    {
        var extension = Uri.TryCreate(url, UriKind.Absolute, out var uri)
            ? Path.GetExtension(uri.AbsolutePath)
            : string.Empty;
        return PictureTypes.ContainsKey(extension) ? $"{PicturesFolder}/{number}{extension.ToLowerInvariant()}" : null;
    }

    // The deck's name as a file name with this extension, such as "Week 1.yml".
    public static string FileName(string deckName, string extension)
    {
        ArgumentNullException.ThrowIfNull(deckName);

        var name = new string([.. deckName.Select(c => char.IsControl(c) || FileNameCharacters.Contains(c) ? '-' : c)])
            .Trim()
            .TrimEnd('.');
        return $"{(name.Length == 0 ? "deck" : name)}.{extension}";
    }

    // The deck in an uploaded file: a YAML file, or a zip file with one in it and its pictures. Throws an
    // InvalidDeckFileException, whose message is for the user, when it isn't one.
    public static DeckUpload Read(byte[] data)
    {
        ArgumentNullException.ThrowIfNull(data);

        if (!IsZip(data))
        {
            return new DeckUpload(Parse(data), archive: null, folder: string.Empty);
        }

        ZipArchive archive;
        try
        {
            archive = new ZipArchive(new MemoryStream(data, writable: false), ZipArchiveMode.Read);
        }
        catch (InvalidDataException ex)
        {
            throw new InvalidDeckFileException("The zip file couldn't be read.", ex);
        }

        try
        {
            // macOS adds a copy of each file's attributes under __MACOSX when it zips a folder.
            var yamls = archive.Entries
                .Where(entry => entry.Name.EndsWith(".yml", StringComparison.OrdinalIgnoreCase)
                    || entry.Name.EndsWith(".yaml", StringComparison.OrdinalIgnoreCase))
                .Where(entry => !entry.FullName.StartsWith("__MACOSX/", StringComparison.Ordinal))
                .ToList();
            if (yamls.Count != 1)
            {
                throw new InvalidDeckFileException("The zip file needs to have one deck's .yml file in it.");
            }

            var yaml = yamls[0];
            var deck = Parse(ReadEntry(yaml, MaxYamlBytes, NotADeckMessage));
            return new DeckUpload(deck, archive, yaml.FullName[..^yaml.Name.Length]);
        }
        catch
        {
            archive.Dispose();
            throw;
        }
    }

    // The picture's content type by its extension, or null when it isn't a kind of picture a card can have.
    public static string? PictureType(string path)
    {
        return PictureTypes.GetValueOrDefault(Path.GetExtension(path));
    }

    // The entry's content, when it's at most this big.
    internal static byte[] ReadEntry(ZipArchiveEntry entry, int maxBytes, string tooBigMessage)
    {
        if (entry.Length > maxBytes)
        {
            throw new InvalidDeckFileException(tooBigMessage);
        }

        try
        {
            var data = new byte[entry.Length];
            using var stream = entry.Open();
            stream.ReadExactly(data);
            return data;
        }
        catch (Exception ex) when (ex is InvalidDataException or EndOfStreamException)
        {
            throw new InvalidDeckFileException("The zip file couldn't be read.", ex);
        }
    }

    // A zip file starts with the signature of its first entry's header (or, empty, of its end).
    private static bool IsZip(byte[] data)
    {
        return data.AsSpan().StartsWith("PK"u8);
    }

    private static DeckFile Parse(byte[] data)
    {
        if (data.Length > MaxYamlBytes)
        {
            throw new InvalidDeckFileException(NotADeckMessage);
        }

        // The reader takes off a byte order mark, which an editor on Windows may have added, and reads UTF-16 by one.
        using var reader = new StreamReader(new MemoryStream(data), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        try
        {
            return Deserializer.Deserialize<DeckFile?>(reader)
                ?? throw new InvalidDeckFileException(NotADeckMessage);
        }
        catch (YamlException ex)
        {
            throw new InvalidDeckFileException(NotADeckMessage, ex);
        }
    }
}
