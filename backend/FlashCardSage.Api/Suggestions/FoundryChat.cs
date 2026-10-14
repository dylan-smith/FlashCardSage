using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Suggestions;

// Asks the chat model (gpt-5-mini) on an Azure AI Foundry resource a question and reads its answer as JSON, for the
// suggesters. It calls the resource's Azure OpenAI v1 chat completions API, which needs no API version.
internal static class FoundryChat
{
    // The answer to the request, read as T, which answerFormat describes as a strict JSON schema. Throws
    // HttpRequestException if the service fails or the answer can't be read.
    public static async Task<T?> AskAsync<T>(
        HttpClient httpClient,
        CardSuggesterOptions options,
        string instructions,
        string request,
        object answerFormat,
        CancellationToken cancellationToken)
    {
        // Short answers don't need much thought, and the page waits for them, so the model reasons briefly. The body
        // is serialized up front so it's sent with a Content-Length, as the Foundry APIs expect.
        var body = JsonSerializer.SerializeToUtf8Bytes(new
        {
            model = options.Deployment,
            messages = new[]
            {
                new { role = "developer", content = instructions },
                new { role = "user", content = request }
            },
            response_format = answerFormat,
            reasoning_effort = "low",
            max_completion_tokens = 4096
        });
        using var message = new HttpRequestMessage(
            HttpMethod.Post, $"{options.Endpoint.TrimEnd('/')}/openai/v1/chat/completions")
        {
            Content = new ByteArrayContent(body)
        };
        message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        message.Headers.Add("api-key", options.Key);

        using var response = await httpClient.SendAsync(message, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            // The service's error code says what went wrong (its message might echo the cards, so it's left out).
            var code = ErrorCode(await response.Content.ReadAsStringAsync(cancellationToken)) is { } errorCode
                ? $" ({errorCode})"
                : string.Empty;
            throw new HttpRequestException(
                $"The suggestion model answered {(int)response.StatusCode}{code}.", null, response.StatusCode);
        }

        var completion = await response.Content.ReadFromJsonAsync<Completion>(cancellationToken);
        if (completion?.Choices is not [{ FinishReason: "stop", Message: { Refusal: null, Content: { } content } }, ..])
        {
            var reason = completion?.Choices is [var choice, ..] ? choice.FinishReason : null;
            throw new HttpRequestException($"The suggestion model gave no suggestions ({reason ?? "no answer"}).");
        }

        try
        {
            return JsonSerializer.Deserialize<T>(content, JsonSerializerOptions.Web);
        }
        catch (JsonException ex)
        {
            throw new HttpRequestException("The suggestion model's answer couldn't be read.", ex);
        }
    }

    // The code of an error response, e.g. content_filter or DeploymentNotFound.
    private static string? ErrorCode(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("error", out var error)
                && error.ValueKind == JsonValueKind.Object
                && error.TryGetProperty("code", out var code)
                && code.ValueKind == JsonValueKind.String
                ? code.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private sealed record Completion([property: JsonPropertyName("choices")] IReadOnlyList<Choice>? Choices);

    private sealed record Choice(
        [property: JsonPropertyName("finish_reason")] string? FinishReason,
        [property: JsonPropertyName("message")] ChoiceMessage? Message);

    private sealed record ChoiceMessage(
        [property: JsonPropertyName("content")] string? Content,
        [property: JsonPropertyName("refusal")] string? Refusal);
}
