namespace FlashCardSage.Api.Authentication;

// Which of the app's own clients a request came from: the website, or the Android app, which shows the same site.
public enum AppClient
{
    Web,
    Android
}

public static class AppClients
{
    // The request header the frontend names its client in (see the frontend's apiFetch).
    public const string HeaderName = "X-FlashCardSage-Client";

    // The client a request's header names, or null when it has none or names something else, as requests from AI
    // assistants and scripts do.
    public static AppClient? FromRequest(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return request.Headers[HeaderName].ToString() switch
        {
            "web" => AppClient.Web,
            "android" => AppClient.Android,
            _ => null
        };
    }
}
