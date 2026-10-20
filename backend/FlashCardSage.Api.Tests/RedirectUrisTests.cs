using FlashCardSage.Api.OAuth;

namespace FlashCardSage.Api.Tests;

public class RedirectUrisTests
{
    [Theory]
    [InlineData("https://claude.ai/api/mcp/auth_callback")]
    [InlineData("https://chatgpt.com/connector_platform_oauth_redirect")]
    [InlineData("http://127.0.0.1/callback")]
    [InlineData("http://localhost:33418/callback")]
    [InlineData("http://[::1]:8080/callback")]
    [InlineData("cursor://anysphere.cursor-retrieval/oauth/callback")]
    [InlineData("com.example.app:/oauth2redirect")]
    public void IsAcceptable_AllowsHttpsLoopbackAndAppSchemes(string uri)
    {
        Assert.True(RedirectUris.IsAcceptable(uri));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("/callback")]
    [InlineData("http://app.example/callback")]
    [InlineData("http://127.0.0.2.example/callback")]
    [InlineData("https://app.example/callback#done")]
    [InlineData("javascript:alert(1)")]
    [InlineData("JavaScript:alert(1)")]
    [InlineData("data:text/html,hi")]
    [InlineData("file:///etc/passwd")]
    [InlineData("blob:https://app.example/1")]
    [InlineData("vbscript:msgbox")]
    [InlineData("about:blank")]
    public void IsAcceptable_RefusesUrisThatCouldLeakTheCode(string? uri)
    {
        Assert.False(RedirectUris.IsAcceptable(uri));
    }

    [Theory]
    [InlineData("https://app.example/cb", "https://app.example/cb", true)]
    [InlineData("https://app.example/cb", "https://app.example/cb/", false)]
    [InlineData("https://app.example/cb", "https://APP.example/cb", false)]
    [InlineData("https://app.example/cb", "https://app.example:443/cb", false)]
    [InlineData("https://app.example/cb", "https://app.example:8443/cb", false)]
    [InlineData("https://app.example/cb", "https://app.example/cb?x=1", false)]
    [InlineData("http://127.0.0.1/callback", "http://127.0.0.1:53111/callback", true)]
    [InlineData("http://127.0.0.1:8000/callback", "http://127.0.0.1:9000/callback", true)]
    [InlineData("http://localhost/callback", "http://localhost:4000/callback", true)]
    [InlineData("http://[::1]/callback", "http://[::1]:4000/callback", true)]
    [InlineData("http://127.0.0.1/callback", "http://localhost:4000/callback", false)]
    [InlineData("http://127.0.0.1/callback", "http://127.0.0.1:4000/other", false)]
    [InlineData("http://127.0.0.1/callback", "https://127.0.0.1:4000/callback", false)]
    [InlineData("http://127.0.0.1/callback", null, false)]
    public void Matches_ComparesExactly_ExceptALoopbackPort(string registered, string? requested, bool matches)
    {
        Assert.Equal(matches, RedirectUris.Matches(registered, requested));
    }
}
