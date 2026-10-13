namespace FlashCardSage.Api.Images;

// Where cards' pictures are kept, from the ImageStore configuration section: Azure Blob Storage when there's a
// connection string, otherwise files on disk (local development and E2E tests).
public class ImageStoreOptions
{
    public const string SectionName = "ImageStore";

    // The path the API serves the local files on.
    public const string LocalRequestPath = "/card-images";

    public string StorageConnectionString { get; set; } = string.Empty;

    public string ContainerName { get; set; } = "card-images";

    // The folder for the local files, relative to the content root unless it's absolute.
    public string LocalPath { get; set; } = "App_Data/card-images";
}
