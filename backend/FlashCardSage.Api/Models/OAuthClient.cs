namespace FlashCardSage.Api.Models;

// An app that signs users in through the API's OAuth server, such as an AI assistant's MCP client (see
// OAuthClientRegistry). It belongs to no user: the users who connect it each have a grant of their own.
public class OAuthClient
{
    public const int MaxClientIdLength = 512;

    public const int MaxNameLength = 200;

    public const int MaxRedirectUriLength = 2000;

    public int Id { get; set; }

    // A random "fcs_c_..." for an app that registered itself, or the https URL of its client ID metadata document.
    public string ClientId { get; set; } = string.Empty;

    // The name the app gave itself, if any.
    public string? Name { get; set; }

    public List<string> RedirectUris { get; set; } = [];

    // Whether ClientId is a metadata document's URL, so the app is known by that URL's host.
    public bool IsMetadataDocument { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    // When the app registered, or its metadata document was last fetched.
    public DateTimeOffset UpdatedAt { get; set; }
}
