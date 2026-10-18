using System.Text.Json;

namespace FlashCardSage.Api.Suggestions.Foundry;

public static class FoundryErrors
{
    // The code of a Foundry API's error response, e.g. content_filter or DeploymentNotFound: the one on the error
    // inside the error when there is one, else the error's. Null when the body isn't an error with a code.
    public static string? Code(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.Object
                ? (error.TryGetProperty("inner_error", out var innerError) ? CodeOf(innerError) : null) ?? CodeOf(error)
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? CodeOf(JsonElement error)
    {
        return error.ValueKind == JsonValueKind.Object
            && error.TryGetProperty("code", out var code)
            && code.ValueKind == JsonValueKind.String
            ? code.GetString()
            : null;
    }
}
