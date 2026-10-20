using FlashCardSage.Api.OAuth;

namespace FlashCardSage.Api.Tests;

public class OAuthTokensTests
{
    [Fact]
    public void NewTokens_HaveTheirPrefix_AndAreRandom()
    {
        Assert.StartsWith(OAuthTokens.AccessTokenPrefix, OAuthTokens.NewAccessToken(), StringComparison.Ordinal);
        Assert.StartsWith(OAuthTokens.RefreshTokenPrefix, OAuthTokens.NewRefreshToken(), StringComparison.Ordinal);
        Assert.StartsWith(OAuthTokens.CodePrefix, OAuthTokens.NewCode(), StringComparison.Ordinal);
        Assert.StartsWith(OAuthTokens.ClientIdPrefix, OAuthTokens.NewClientId(), StringComparison.Ordinal);
        Assert.NotEqual(OAuthTokens.NewAccessToken(), OAuthTokens.NewAccessToken());
        // 32 random bytes in base64url, with no padding.
        Assert.Equal(OAuthTokens.AccessTokenPrefix.Length + 43, OAuthTokens.NewAccessToken().Length);
    }

    [Fact]
    public void Hash_IsTheLowercaseHexSha256()
    {
        Assert.Equal(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            OAuthTokens.Hash("abc"));
        Assert.Equal(OAuthTokens.HashLength, OAuthTokens.Hash(OAuthTokens.NewAccessToken()).Length);
    }

    [Theory]
    [InlineData("fcs_at_abc", true)]
    [InlineData("fcs_rt_abc", false)]
    [InlineData("FCS_AT_abc", false)]
    [InlineData("test:Alice", false)]
    [InlineData(null, false)]
    public void IsAccessToken_GoesByThePrefix(string? token, bool isAccessToken)
    {
        Assert.Equal(isAccessToken, OAuthTokens.IsAccessToken(token));
    }

    [Theory]
    [InlineData(null, "flashcards")]
    [InlineData("", "flashcards")]
    [InlineData("offline_access", "flashcards")]
    [InlineData("flashcards  offline_access", "flashcards")]
    [InlineData("flashcards flashcards", "flashcards")]
    [InlineData("flashcards admin", null)]
    [InlineData("openid", null)]
    public void NormalizeScope_LeavesOutOfflineAccess_AndRefusesOtherScopes(string? scope, string? normalized)
    {
        Assert.Equal(normalized, OAuthServerOptions.NormalizeScope(scope));
    }
}
