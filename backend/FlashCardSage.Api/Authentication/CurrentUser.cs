namespace FlashCardSage.Api.Authentication;

/// <summary>
/// The signed-in user of the current request, set by <see cref="CurrentUserMiddleware"/>. Null when nobody is signed in,
/// in which case no flash cards are visible.
/// </summary>
public class CurrentUser
{
    public int? UserId { get; set; }
}
