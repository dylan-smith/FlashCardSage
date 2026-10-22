using System.Net;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts.Admin;
using Microsoft.AspNetCore.Mvc.Testing;

namespace FlashCardSage.Api.Tests;

public class AdminControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    public static TheoryData<string> Endpoints => new()
    {
        "/api/admin/overview",
        "/api/admin/users",
        "/api/admin/users/1",
        "/api/admin/users/1/cards"
    };

    [Fact]
    public async Task Admin_SeesEveryonesData()
    {
        // Development's Admin:Users lists test:admin.
        using var app = TestApp.CreateFactory(factory);
        using var admin = TestApp.CreateClient(app, "test:Admin");
        var name = $"Alice {Guid.NewGuid()}";
        using var alice = TestApp.CreateClient(app, $"test:{name}");
        (await alice.PostAsJsonAsync("/api/flashcards", TestDb.CardBody("el gato", "the cat"))).EnsureSuccessStatusCode();

        var overview = await admin.GetFromJsonAsync<AdminOverviewResponse>("/api/admin/overview");
        var users = await admin.GetFromJsonAsync<List<AdminUserSummary>>("/api/admin/users");
        var user = Assert.Single(users!, item => item.DisplayName == name);
        var detail = await admin.GetFromJsonAsync<AdminUserDetail>($"/api/admin/users/{user.Id}");
        var cards = await admin.GetFromJsonAsync<List<AdminCardSummary>>($"/api/admin/users/{user.Id}/cards");

        Assert.True(overview!.Cards >= 1);
        Assert.Equal(("test", 1), (user.Provider, user.Cards));
        Assert.Equal(user, detail!.User);
        var card = Assert.Single(cards!);
        Assert.Equal(["el gato"], card.Spanish);
        Assert.Equal("Manual", card.Source);
    }

    [Theory]
    [InlineData("/api/admin/users/2147483647")]
    [InlineData("/api/admin/users/2147483647/cards")]
    public async Task Admin_GetsNotFound_ForAnUnknownUser(string path)
    {
        using var admin = TestApp.CreateSignedInClient(factory, "Admin");

        var response = await admin.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Endpoints_AreForbidden_ForSomeoneWhoIsntAnAdmin(string path)
    {
        using var client = TestApp.CreateSignedInClient(factory);

        var response = await client.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [MemberData(nameof(Endpoints))]
    public async Task Endpoints_AreUnauthorized_WhenSignedOut(string path)
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var response = await client.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task OpenApi_DescribesTheAdminEndpoints()
    {
        using var client = TestApp.CreateSignedOutClient(factory);

        var document = await client.GetStringAsync(new Uri("/openapi/v1.json", UriKind.Relative));

        Assert.Contains("\"/api/admin/users/{id}/cards\"", document, StringComparison.Ordinal);
        Assert.Contains("\"AdminUserDetail\"", document, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Endpoints_AreForbidden_WhenNobodyIsAnAdmin()
    {
        using var client = TestApp.CreateSignedInClient(
            factory, "Admin", new Dictionary<string, string> { ["Admin:Users:0"] = "" });

        var response = await client.GetAsync(new Uri("/api/admin/overview", UriKind.Relative));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }
}
