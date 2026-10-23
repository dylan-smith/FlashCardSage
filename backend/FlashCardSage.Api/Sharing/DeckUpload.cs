using System.IO.Compression;
using FlashCardSage.Api.Images;

namespace FlashCardSage.Api.Sharing;

// A deck file the user uploaded (see DeckPackage.Read), and for a zip file, the pictures in it, read as they're asked
// for. A YAML file on its own has no pictures, only generated ones by their ids.
public sealed class DeckUpload(DeckFile deck, ZipArchive? archive, string folder) : IDisposable
{
    // How much of the pictures has been unzipped, which can't be more than the file the zip could be.
    private long unzippedBytes;

    public DeckFile Deck { get; } = deck;

    // The picture at this path, from the YAML file's folder, checked as any picture put on a card is. Throws an
    // InvalidDeckFileException, whose message is for the user, when there isn't one.
    public (ReadOnlyMemory<byte> Data, string ContentType) ReadPicture(string path)
    {
        ArgumentNullException.ThrowIfNull(path);

        var name = path.Replace('\\', '/');
        var entry = archive?.GetEntry(folder + name)
            ?? throw new InvalidDeckFileException(archive is null
                ? $"Its picture {name} is only in the deck's zip file. Import that instead."
                : $"Its picture {name} isn't in the zip file.");

        var contentType = DeckPackage.PictureType(name)
            ?? throw new InvalidDeckFileException("Its picture must be a JPEG, PNG or WebP.");
        var data = DeckPackage.ReadEntry(entry, CardImage.MaxBytes, CardImage.TooBigMessage);

        unzippedBytes += data.Length;
        if (unzippedBytes > DeckPackage.MaxFileBytes)
        {
            throw new InvalidDeckFileException(
                $"The deck's pictures can come to at most {DeckPackage.MaxFileBytes / 1024 / 1024} MB.");
        }

        var valid = CardImage.TryValidate(data, contentType, out var normalizedContentType, out var error);
        return valid
            ? (data, normalizedContentType)
            : throw new InvalidDeckFileException(error);
    }

    public void Dispose()
    {
        archive?.Dispose();
    }
}
