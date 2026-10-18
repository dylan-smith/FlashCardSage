using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Translation;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class TranslationsControllerTests(WebApplicationFactory<Program> factory)
    : IClassFixture<WebApplicationFactory<Program>>
{
    [Fact]
    public async Task Translate_ReturnsTheTranslationOfTheTrimmedText()
    {
        var translator = new FakeTranslator { Result = new TranslationResult("silla", ["cátedra", "presidente"]) };

        var result = await CreateController(translator).Translate(
            new TranslationRequest { Text = "  el gato ", From = Language.Spanish },
            CancellationToken.None);

        var response = Assert.IsType<TranslationResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal("silla", response.Translation);
        Assert.Equal(["cátedra", "presidente"], response.Alternatives);
        Assert.Equal(("el gato", Language.Spanish), (translator.Text, translator.From));
    }

    [Fact]
    public async Task Translate_ReturnsValidationProblem_WhenTheTextIsBlank()
    {
        var translator = new FakeTranslator();

        var result = await CreateController(translator).Translate(
            new TranslationRequest { Text = "   ", From = Language.English },
            CancellationToken.None);

        var problem = Assert.IsType<ObjectResult>(result.Result);
        var details = Assert.IsType<ValidationProblemDetails>(problem.Value);
        Assert.Equal("Text is required.", Assert.Single(details.Errors["Text"]));
        Assert.Null(translator.Text);
    }

    [Fact]
    public async Task Translate_ReturnsServiceUnavailable_WhenTranslationIsOff()
    {
        var translator = new FakeTranslator { IsAvailable = false };

        var result = await CreateController(translator).Translate(
            new TranslationRequest { Text = "el gato", From = Language.Spanish },
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status503ServiceUnavailable, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Null(translator.Text);
    }

    [Fact]
    public async Task Translate_ReturnsBadGateway_WhenTheTranslatorFails()
    {
        var translator = new FakeTranslator { Failure = new HttpRequestException("boom") };

        var result = await CreateController(translator).Translate(
            new TranslationRequest { Text = "el gato", From = Language.Spanish },
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Translate_ReturnsBadGateway_WhenTheTranslatorTimesOut()
    {
        var translator = new FakeTranslator { Failure = new TaskCanceledException("timed out") };

        var result = await CreateController(translator).Translate(
            new TranslationRequest { Text = "el gato", From = Language.Spanish },
            CancellationToken.None);

        Assert.Equal(StatusCodes.Status502BadGateway, Assert.IsType<ObjectResult>(result.Result).StatusCode);
    }

    [Fact]
    public async Task Translate_RequiresSignIn()
    {
        using var client = CreateClient(signedIn: false);

        var response = await client.PostAsJsonAsync("/api/translations", new { text = "el gato", from = "Spanish" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Translate_IsUnavailable_WithoutATranslatorKey()
    {
        using var client = CreateClient(signedIn: true);

        var response = await client.PostAsJsonAsync("/api/translations", new { text = "el gato", from = "Spanish" });

        Assert.Equal(HttpStatusCode.ServiceUnavailable, response.StatusCode);
    }

    [Fact]
    public async Task Translate_RefusesAnUnknownLanguage()
    {
        using var client = CreateClient(signedIn: true);

        var response = await client.PostAsJsonAsync("/api/translations", new { text = "el gato", from = "French" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    private static TranslationsController CreateController(ITranslator translator)
    {
        return new TranslationsController(translator, NullLogger<TranslationsController>.Instance);
    }

    private HttpClient CreateClient(bool signedIn)
    {
        // Development uses the in-memory database and allows test sign-in, so the app starts without SQL Server.
        var client = factory
            .WithWebHostBuilder(builder => builder
                .UseEnvironment("Development")
                .UseSetting("Authentication:AllowTestSignIn", "true")
                .UseSetting("Translator:Key", ""))
            .CreateClient();
        if (signedIn)
        {
            client.DefaultRequestHeaders.Authorization =
                new AuthenticationHeaderValue("Bearer", $"test:Translations {Guid.NewGuid()}");
        }

        return client;
    }

    private sealed class FakeTranslator : ITranslator
    {
        public bool IsAvailable { get; init; } = true;

        public TranslationResult Result { get; init; } = new(string.Empty, []);

        public Exception? Failure { get; init; }

        public string? Text { get; private set; }

        public Language? From { get; private set; }

        public Task<TranslationResult> TranslateAsync(string text, Language from, CancellationToken cancellationToken)
        {
            Text = text;
            From = from;
            return Failure is null ? Task.FromResult(Result) : Task.FromException<TranslationResult>(Failure);
        }
    }
}
