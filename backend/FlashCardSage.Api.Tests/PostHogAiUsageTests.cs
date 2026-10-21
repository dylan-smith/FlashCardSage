using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Observability;
using FlashCardSage.Api.Startup;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using PostHog;
using PostHog.Api;

namespace FlashCardSage.Api.Tests;

public class PostHogAiUsageTests
{
    private static readonly AiGeneration Generation = new(
        "card_suggestions",
        "gpt-5-mini-2025-08-07",
        "https://foundry.example/",
        [new AiMessage("developer", "Help."), new AiMessage("user", "Suggest cards.")],
        TimeSpan.FromSeconds(1.5))
    {
        Output = """{"cards":[]}""",
        InputTokens = 1200,
        CachedInputTokens = 256,
        OutputTokens = 300,
        ReasoningTokens = 192,
        MaxTokens = 4096,
        FinishReason = "stop",
        HttpStatus = 200
    };

    [Fact]
    public void Properties_DescribeTheCall_AsPostHogsAiObservabilityExpects()
    {
        var properties = PostHogAiUsage.Properties(Generation, "pr-12", "trace-1");

        Assert.Equal("trace-1", properties["$ai_trace_id"]);
        Assert.Equal("card_suggestions", properties["$ai_span_name"]);
        Assert.Equal("card_suggestions", properties["feature"]);
        Assert.Equal("gpt-5-mini-2025-08-07", properties["$ai_model"]);
        Assert.Equal("azure", properties["$ai_provider"]);
        Assert.Equal("https://foundry.example/", properties["$ai_base_url"]);
        var input = Assert.IsType<List<Dictionary<string, string>>>(properties["$ai_input"]);
        Assert.Equal(["developer", "user"], input.Select(message => message["role"]));
        Assert.Equal("Suggest cards.", input[1]["content"]);
        var output = Assert.Single(Assert.IsType<Dictionary<string, string>[]>(properties["$ai_output_choices"]));
        Assert.Equal("assistant", output["role"]);
        Assert.Equal("""{"cards":[]}""", output["content"]);
        Assert.Equal(1200, properties["$ai_input_tokens"]);
        Assert.Equal(256, properties["$ai_cache_read_input_tokens"]);
        Assert.Equal(300, properties["$ai_output_tokens"]);
        Assert.Equal(192, properties["reasoning_tokens"]);
        Assert.Equal(4096, properties["$ai_max_tokens"]);
        Assert.Equal("stop", properties["finish_reason"]);
        Assert.Equal(200, properties["$ai_http_status"]);
        Assert.Equal(1.5, properties["$ai_latency"]);
        Assert.Equal(false, properties["$ai_is_error"]);
        Assert.Equal("pr-12", properties["environment"]);
        Assert.False(properties.ContainsKey("$ai_error"));
        Assert.False(properties.ContainsKey("image_bytes"));
    }

    [Fact]
    public void Properties_MarkAFailedCall_AndLeaveOutWhatIsntKnown()
    {
        var failed = new AiGeneration("card_picture", "flux-2-pro", "https://foundry.example/", [], TimeSpan.Zero)
        {
            HttpStatus = 429,
            Error = "The image generator answered 429."
        };

        var properties = PostHogAiUsage.Properties(failed, string.Empty, null);

        Assert.Equal(true, properties["$ai_is_error"]);
        Assert.Equal("The image generator answered 429.", properties["$ai_error"]);
        Assert.Equal(32, Assert.IsType<string>(properties["$ai_trace_id"]).Length);
        Assert.False(properties.ContainsKey("$ai_output_choices"));
        Assert.False(properties.ContainsKey("$ai_input_tokens"));
        Assert.False(properties.ContainsKey("environment"));
    }

    [Fact]
    public async Task Record_SendsTheCall_AsTheSignedInUsersAiGenerationEvent()
    {
        var captured = new List<CapturedEvent>();
        await using var services = Services(captured, out var currentUser);
        currentUser.UserId = 42;

        services.GetRequiredService<IAiUsage>().Record(Generation);
        await services.GetRequiredService<IPostHogClient>().FlushAsync();

        var captureEvent = Assert.Single(captured);
        Assert.Equal("$ai_generation", captureEvent.EventName);
        Assert.Equal("42", captureEvent.DistinctId);
        Assert.Equal("card_suggestions", captureEvent.Properties["$ai_span_name"]);
        Assert.Equal("test", captureEvent.Properties["environment"]);
    }

    [Fact]
    public async Task Record_SendsNothing_WithoutASignedInUser()
    {
        var captured = new List<CapturedEvent>();
        await using var services = Services(captured, out _);

        services.GetRequiredService<IAiUsage>().Record(Generation);
        await services.GetRequiredService<IPostHogClient>().FlushAsync();

        Assert.Empty(captured);
    }

    [Fact]
    public void AddAiUsageTracking_RecordsNothing_WithoutAProjectToken()
    {
        var services = new ServiceCollection();
        services.AddAiUsageTracking(new ConfigurationBuilder().Build());

        using var provider = services.BuildServiceProvider();

        Assert.IsType<NullAiUsage>(provider.GetRequiredService<IAiUsage>());
        Assert.Null(provider.GetService<IPostHogClient>());
    }

    // The API's PostHog setup, with a project token, keeping every event it would send instead of sending it.
    private static ServiceProvider Services(List<CapturedEvent> captured, out CurrentUser currentUser)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["PostHog:ProjectToken"] = "phc_test",
                ["PostHog:Environment"] = "test"
            })
            .Build();
        var services = new ServiceCollection();
        services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));
        services.AddSingleton<IConfiguration>(configuration);
        services.AddAiUsageTracking(configuration);
        services.PostConfigure<PostHogOptions>(options => options.BeforeSend = captureEvent =>
        {
            captured.Add(captureEvent);
            return null;
        });
        currentUser = new CurrentUser();
        services.AddSingleton(currentUser);
        return services.BuildServiceProvider();
    }
}
