using FlashCardSage.Api.OAuth;

namespace FlashCardSage.Api.Tests;

public class PkceTests
{
    // RFC 7636 appendix B.
    private const string Verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

    private const string Challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

    [Fact]
    public void Challenge_IsTheBase64UrlSha256OfTheVerifier()
    {
        Assert.Equal(Challenge, Pkce.Challenge(Verifier));
    }

    [Fact]
    public void Verify_AcceptsTheVerifier_AndNothingElse()
    {
        Assert.True(Pkce.Verify(Verifier, Challenge));
        Assert.False(Pkce.Verify(Verifier[..^1] + "Y", Challenge));
        Assert.False(Pkce.Verify(null, Challenge));
        Assert.False(Pkce.Verify(Challenge, Challenge));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("short", false)]
    [InlineData("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ", true)]
    [InlineData("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP", false)]
    [InlineData("abcdefghijklmnopqrstuvwxyz-._~0123456789ABCDEFG", true)]
    [InlineData("abcdefghijklmnopqrstuvwxyz+/=0123456789ABCDEFG", false)]
    public void IsValidVerifier_Takes43To128UnreservedCharacters(string? verifier, bool valid)
    {
        Assert.Equal(valid, Pkce.IsValidVerifier(verifier));
    }

    [Fact]
    public void IsValidVerifier_RefusesMoreThan128Characters()
    {
        Assert.True(Pkce.IsValidVerifier(new string('a', 128)));
        Assert.False(Pkce.IsValidVerifier(new string('a', 129)));
    }

    [Fact]
    public void IsValidChallenge_TakesAnS256Hash()
    {
        Assert.True(Pkce.IsValidChallenge(Challenge));
        Assert.False(Pkce.IsValidChallenge(Challenge + "A"));
        Assert.False(Pkce.IsValidChallenge(Challenge[..^1] + "="));
        Assert.False(Pkce.IsValidChallenge(null));
    }
}
