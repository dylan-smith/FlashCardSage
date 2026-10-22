using System.Security.Claims;
using FlashCardSage.Api.Admin;
using FlashCardSage.Api.Authentication;
using Microsoft.Extensions.Configuration;

namespace FlashCardSage.Api.Tests;

public class AdminUsersTests
{
    [Fact]
    public void Contains_MatchesTheEmail_IgnoringCase()
    {
        var adminUsers = FromSettings("Admin@Example.com");

        Assert.True(adminUsers.Contains(User("google:123", "admin@example.COM")));
        Assert.False(adminUsers.Contains(User("google:123", "someone@example.com")));
        Assert.False(adminUsers.Contains(User("google:123", email: null)));
    }

    [Fact]
    public void Contains_MatchesTheSubject_IgnoringCase()
    {
        var adminUsers = FromSettings("google:123", "test:admin");

        Assert.True(adminUsers.Contains(User("google:123", "someone@example.com")));
        Assert.True(adminUsers.Contains(User("TEST:Admin", email: null)));
        Assert.False(adminUsers.Contains(User("google:1234", email: null)));
    }

    [Fact]
    public void Contains_IsFalse_ForASignedOutUser()
    {
        var adminUsers = FromSettings("test:admin");
        var signedOut = new ClaimsPrincipal(new ClaimsIdentity([new Claim(AuthenticationSetup.SubjectClaim, "test:admin")]));

        Assert.False(adminUsers.Contains(signedOut));
    }

    [Fact]
    public void FromConfiguration_TrimsEntries_AndDropsBlankOnes()
    {
        var adminUsers = FromSettings(" admin@example.com ", "", "   ");

        Assert.Equal(1, adminUsers.Count);
        Assert.True(adminUsers.Contains(User("google:123", "admin@example.com")));
        Assert.False(adminUsers.Contains(User("google:123", email: null)));
    }

    [Fact]
    public void FromConfiguration_MakesNobodyAnAdmin_WithoutEntries()
    {
        var adminUsers = AdminUsers.FromConfiguration(new ConfigurationBuilder().Build());

        Assert.Equal(0, adminUsers.Count);
        Assert.False(adminUsers.Contains(User("test:admin", "admin@example.com")));
    }

    private static AdminUsers FromSettings(params string[] entries)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(entries.Select((entry, i) => KeyValuePair.Create($"Admin:Users:{i}", (string?)entry)))
            .Build();

        return AdminUsers.FromConfiguration(configuration);
    }

    private static ClaimsPrincipal User(string subject, string? email)
    {
        return new(AuthenticationSetup.CreateIdentity(LocalTokenHandler.SchemeName, subject, name: null, email));
    }
}
