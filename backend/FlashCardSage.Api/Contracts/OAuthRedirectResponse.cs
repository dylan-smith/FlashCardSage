namespace FlashCardSage.Api.Contracts;

// Where the consent page sends the browser once the user has approved or denied a sign-in: back to the app.
public record OAuthRedirectResponse(string RedirectUrl);
