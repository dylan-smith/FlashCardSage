using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Services;

/// <summary>
/// What became of putting a picture on a card or taking it off (see CardPictureService), for the caller to turn into a
/// response.
/// </summary>
public abstract record PictureResult
{
    private PictureResult()
    {
    }

    // The card with its words and tags, as it is now.
    public sealed record Changed(FlashCard Card) : PictureResult;

    public sealed record NotFound : PictureResult;

    // What's wrong with the picture, in words for the user, and the request field it's about.
    public sealed record Invalid(string Field, string Message) : PictureResult;
}
