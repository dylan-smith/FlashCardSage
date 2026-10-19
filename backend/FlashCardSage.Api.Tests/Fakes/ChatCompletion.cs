using System.Text.Json;

namespace FlashCardSage.Api.Tests.Fakes;

internal static class ChatCompletion
{
    // A chat completion whose answer is this text, as the chat completions API sends it, with its token usage.
    public static string Json(string content, string finishReason = "stop", string? refusal = null)
    {
        return JsonSerializer.Serialize(new
        {
            id = "chatcmpl-test",
            @object = "chat.completion",
            model = "gpt-5-mini-2025-08-07",
            choices = new[]
            {
                new
                {
                    index = 0,
                    finish_reason = finishReason,
                    message = new { role = "assistant", content, refusal }
                }
            },
            usage = new
            {
                prompt_tokens = 1200,
                completion_tokens = 300,
                total_tokens = 1500,
                prompt_tokens_details = new { cached_tokens = 256 },
                completion_tokens_details = new { reasoning_tokens = 192 }
            }
        });
    }
}
