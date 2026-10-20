using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Contracts;

// The query string an app sends the user to /oauth/authorize with (RFC 6749 section 4.1.1, with PKCE and RFC 8707's
// resource). Everything is optional, with no validation attributes, so a bad request is answered the way OAuth says
// (see OAuthAuthorizationService.BeginAsync) rather than with a validation problem.
public class OAuthAuthorizeRequest
{
    [FromQuery(Name = "response_type")]
    public string? ResponseType { get; set; }

    [FromQuery(Name = "client_id")]
    public string? ClientId { get; set; }

    [FromQuery(Name = "redirect_uri")]
    public string? RedirectUri { get; set; }

    [FromQuery(Name = "scope")]
    public string? Scope { get; set; }

    [FromQuery(Name = "state")]
    public string? State { get; set; }

    [FromQuery(Name = "code_challenge")]
    public string? CodeChallenge { get; set; }

    [FromQuery(Name = "code_challenge_method")]
    public string? CodeChallengeMethod { get; set; }

    [FromQuery(Name = "resource")]
    public string? Resource { get; set; }
}
