using FlashCardSage.Api.Suggestions.Foundry;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Tests.Fakes;

internal static class FoundryTestOptions
{
    // A chat model that's set up, at an endpoint the tests' handler stands in for. New each time, so no test can change
    // another's.
    public static IOptions<FoundryChatOptions> Default => Options.Create(new FoundryChatOptions
    {
        Endpoint = "https://foundry.example/",
        Key = "secret-key",
        Deployment = "gpt-test"
    });
}
