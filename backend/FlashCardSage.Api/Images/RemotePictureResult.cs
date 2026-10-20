namespace FlashCardSage.Api.Images;

/// <summary>
/// What became of downloading a picture from a URL the user gave (see RemotePictureFetcher).
/// </summary>
public abstract record RemotePictureResult
{
    private RemotePictureResult()
    {
    }

    // The picture, checked to be a kind a card can have and within the limit, and its content type as a store keeps it.
    public sealed record Fetched(ReadOnlyMemory<byte> Data, string ContentType) : RemotePictureResult;

    // Why the picture wasn't downloaded, in words for the user.
    public sealed record Refused(string Reason) : RemotePictureResult;
}
