using System.Net.Http.Headers;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace FlashCardSage.Api.Tests;

// Copies of the whole app for the tests that send it requests, and clients for them.
internal static class TestApp
{
    // A copy of the app with these settings on top, and these changes to its services. Development uses the in-memory
    // database and allows test sign-in, so the app starts without SQL Server. The caller disposes it.
    public static WebApplicationFactory<Program> CreateFactory(
        WebApplicationFactory<Program> factory,
        IReadOnlyDictionary<string, string>? settings = null,
        Action<IServiceCollection>? services = null)
    {
        ArgumentNullException.ThrowIfNull(factory);

        return factory.WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development").UseSetting("Authentication:AllowTestSignIn", "true");
            foreach (var (key, value) in settings ?? new Dictionary<string, string>())
            {
                builder.UseSetting(key, value);
            }

            if (services is not null)
            {
                builder.ConfigureTestServices(services);
            }
        });
    }

    // A client for the copy of the app, sending the token with every request when there is one.
    public static HttpClient CreateClient(WebApplicationFactory<Program> app, string? token = null)
    {
        ArgumentNullException.ThrowIfNull(app);

        var client = app.CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    // A client for a copy of the app of its own, signed in through test sign-in as the user (a new one unless one is
    // named). Disposing the client disposes the copy.
    public static HttpClient CreateSignedInClient(
        WebApplicationFactory<Program> factory, string? user = null, IReadOnlyDictionary<string, string>? settings = null)
    {
        return CreateOwningClient(CreateFactory(factory, settings), $"test:{user ?? $"Tester {Guid.NewGuid()}"}");
    }

    // A client for a copy of the app of its own, sending no token. Disposing the client disposes the copy.
    public static HttpClient CreateSignedOutClient(
        WebApplicationFactory<Program> factory, IReadOnlyDictionary<string, string>? settings = null)
    {
        return CreateOwningClient(CreateFactory(factory, settings), null);
    }

    // Unlike WebApplicationFactory.CreateClient's, it doesn't follow redirects or keep cookies, which the API doesn't
    // use: it signs in with a bearer token and only redirects to HTTPS, which tests never ask for.
    private static HttpClient CreateOwningClient(WebApplicationFactory<Program> app, string? token)
    {
        var client = app.CreateDefaultClient(new AppOwner(app));
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        return client;
    }

    // Disposes the copy of the app along with the client, so it doesn't stay up until the test class is done.
    private sealed class AppOwner(WebApplicationFactory<Program> app) : DelegatingHandler
    {
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing)
            {
                app.Dispose();
            }
        }
    }
}
