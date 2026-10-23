namespace FlashCardSage.Api.Sharing;

// A deck as a YAML file to share, such as a teacher's deck for a lesson that their students import (see
// DeckPackage). The properties are written in camel case, and a file can leave out any that are empty. It's what
// people read and write by hand, so it holds words and names only, never ids of the user's own rows.
public sealed class DeckFile
{
    // The version DeckPackage writes, and the newest it reads.
    public const int CurrentVersion = 1;

    public int Version { get; set; } = CurrentVersion;

    public string? Name { get; set; }

    // A list read from YAML can hold nulls despite its type, for an item left blank.
    public List<DeckFileCard?>? Cards { get; set; } = [];
}

// One of the deck's cards: its words and tags by name, and its picture, if it has one.
public sealed class DeckFileCard
{
    public List<string?>? Spanish { get; set; } = [];

    public List<string?>? English { get; set; } = [];

    public List<string?>? Tags { get; set; } = [];

    // A generated picture, by its id in the picture cache, which every user shares (see CachedImageGenerator), so the
    // file doesn't need to carry it.
    public int? PictureId { get; set; }

    // A picture of the user's own, such as a photo they uploaded, by its path in the zip file, from the YAML file's
    // folder there.
    public string? PictureFile { get; set; }
}
