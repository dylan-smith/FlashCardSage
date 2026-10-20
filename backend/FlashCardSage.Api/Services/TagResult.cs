using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Services;

/// <summary>
/// What became of a change to the user's tags (see TagService), for the caller to turn into a response.
/// </summary>
public abstract record TagResult
{
    private TagResult()
    {
    }

    // The tag was made or renamed.
    public sealed record Saved(Tag Tag) : TagResult;

    public sealed record Deleted : TagResult;

    public sealed record NotFound : TagResult;

    // The request's problems as (field, message) pairs, in the order they were found.
    public sealed record Invalid(IReadOnlyList<KeyValuePair<string, string>> Errors) : TagResult;
}
