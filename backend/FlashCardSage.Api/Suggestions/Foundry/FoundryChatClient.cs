using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using FlashCardSage.Api.Observability;

namespace FlashCardSage.Api.Suggestions.Foundry;

// Asks the chat model (gpt-5-mini) on an Azure AI Foundry resource a question and reads its answer as JSON, for the
// suggesters. It calls the resource's Azure OpenAI v1 chat completions API, which needs no API version.
//
// Every answer's token usage is logged, for the FlashCardSage AI workbook (infra/workbooks/ai.workbook.json), which
// finds the feature it was for by the request that asked. Every call, with its prompt and answer, is also recorded
// for PostHog's AI observability, under the feature's name (e.g. card_suggestions).
public class FoundryChatClient(
    HttpClient httpClient, FoundryChatOptions options, ILogger logger, IAiUsage aiUsage, string feature)
{
    // Enough for a handful of suggestions and the reasoning behind them.
    public const int ShortAnswerTokens = 4096;

    public bool IsAvailable => options.IsAvailable;

    // The answer to the request, read as T, which answerFormat describes as a strict JSON schema (see FoundrySchemas).
    // maxCompletionTokens covers the model's reasoning as well as its answer. Throws HttpRequestException if the
    // service fails or the answer can't be read.
    public async Task<T?> AskAsync<T>(
        string instructions,
        string request,
        object answerFormat,
        int maxCompletionTokens,
        CancellationToken cancellationToken)
    {
        // Short answers don't need much thought, and the page waits for them, so the model reasons briefly.
        using var message = new HttpRequestMessage(
            HttpMethod.Post, $"{options.Endpoint.TrimEnd('/')}/openai/v1/chat/completions")
        {
            Content = JsonBody.Create(new
            {
                model = options.Deployment,
                messages = new[]
                {
                    new { role = "developer", content = instructions },
                    new { role = "user", content = request }
                },
                response_format = answerFormat,
                reasoning_effort = "low",
                max_completion_tokens = maxCompletionTokens
            })
        };
        message.Headers.Add("api-key", options.Key);

        var started = Stopwatch.GetTimestamp();
        AiGeneration Generation()
        {
            return new(
                feature,
                options.Deployment,
                options.Endpoint,
                [new AiMessage("developer", instructions), new AiMessage("user", request)],
                Stopwatch.GetElapsedTime(started))
            {
                MaxTokens = maxCompletionTokens
            };
        }

        using var response = await aiUsage.SendAsync(httpClient, message, Generation, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            // The service's error code says what went wrong (its message might echo the cards, so it's left out).
            var code = FoundryErrors.Code(await response.Content.ReadAsStringAsync(cancellationToken)) is { } errorCode
                ? $" ({errorCode})"
                : string.Empty;
            var failure = new HttpRequestException(
                $"The suggestion model answered {(int)response.StatusCode}{code}.", null, response.StatusCode);
            aiUsage.Record(Generation() with { HttpStatus = (int)response.StatusCode, Error = failure.Message });
            throw failure;
        }

        var completion = await response.Content.ReadFromJsonAsync<Completion>(cancellationToken);
        var answered = completion?.Choices is [{ Message: var answer }, ..] ? answer : null;
        var generation = Generation() with
        {
            Model = completion?.Model ?? options.Deployment,
            Output = answered?.Content ?? answered?.Refusal,
            InputTokens = completion?.Usage?.PromptTokens,
            CachedInputTokens = completion?.Usage?.PromptTokensDetails?.CachedTokens,
            OutputTokens = completion?.Usage?.CompletionTokens,
            ReasoningTokens = completion?.Usage?.CompletionTokensDetails?.ReasoningTokens,
            FinishReason = completion?.Choices is [var only, ..] ? only.FinishReason : null,
            HttpStatus = (int)response.StatusCode
        };

        // An answer that can't be used is paid for all the same, so it's logged before it's checked.
        if (completion?.Usage is { } usage)
        {
            logger.LogInformation(
                "The suggestion model {ChatModel} used {PromptTokens} prompt tokens ({CachedPromptTokens} cached) and {CompletionTokens} completion tokens ({ReasoningTokens} reasoning), finishing with {FinishReason}",
                completion.Model,
                usage.PromptTokens,
                usage.PromptTokensDetails?.CachedTokens ?? 0,
                usage.CompletionTokens,
                usage.CompletionTokensDetails?.ReasoningTokens ?? 0,
                completion.Choices is [var first, ..] ? first.FinishReason : null);
        }

        if (completion?.Choices is not [{ FinishReason: "stop", Message: { Refusal: null, Content: { } content } }, ..])
        {
            var reason = completion?.Choices is [var choice, ..] ? choice.FinishReason : null;
            var unusable = new HttpRequestException(
                $"The suggestion model gave no suggestions ({reason ?? "no answer"}).");
            aiUsage.Record(generation with { Error = unusable.Message });
            throw unusable;
        }

        T? result;
        try
        {
            result = JsonSerializer.Deserialize<T>(content, JsonSerializerOptions.Web);
        }
        catch (JsonException ex)
        {
            var unreadable = new HttpRequestException("The suggestion model's answer couldn't be read.", ex);
            aiUsage.Record(generation with { Error = unreadable.Message });
            throw unreadable;
        }

        aiUsage.Record(generation);
        return result;
    }

    private sealed record Completion(
        [property: JsonPropertyName("model")] string? Model,
        [property: JsonPropertyName("choices")] IReadOnlyList<Choice>? Choices,
        [property: JsonPropertyName("usage")] TokenUsage? Usage);

    private sealed record TokenUsage(
        [property: JsonPropertyName("prompt_tokens")] int PromptTokens,
        [property: JsonPropertyName("completion_tokens")] int CompletionTokens,
        [property: JsonPropertyName("prompt_tokens_details")] PromptTokensDetails? PromptTokensDetails,
        [property: JsonPropertyName("completion_tokens_details")] CompletionTokensDetails? CompletionTokensDetails);

    private sealed record PromptTokensDetails([property: JsonPropertyName("cached_tokens")] int CachedTokens);

    private sealed record CompletionTokensDetails([property: JsonPropertyName("reasoning_tokens")] int ReasoningTokens);

    private sealed record Choice(
        [property: JsonPropertyName("finish_reason")] string? FinishReason,
        [property: JsonPropertyName("message")] ChoiceMessage? Message);

    private sealed record ChoiceMessage(
        [property: JsonPropertyName("content")] string? Content,
        [property: JsonPropertyName("refusal")] string? Refusal);
}
