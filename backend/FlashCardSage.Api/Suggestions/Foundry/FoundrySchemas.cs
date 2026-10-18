namespace FlashCardSage.Api.Suggestions.Foundry;

// Answer formats for FoundryChatClient.AskAsync, which define the answer as JSON so it can be read without picking it
// out of prose. Strict structured output needs every property required and no others allowed.
public static class FoundrySchemas
{
    // An answer of a list of cards, { "cards": [{ "spanish": ..., "english": ... }] }, read as CardSuggestions.
    public static object Cards(string name)
    {
        var cards = new
        {
            type = "array",
            items = new
            {
                type = "object",
                properties = new { spanish = new { type = "string" }, english = new { type = "string" } },
                required = new[] { "spanish", "english" },
                additionalProperties = false
            }
        };
        return Strict(name, new { cards }, "cards");
    }

    // An answer of a list of strings, { property: [...] }.
    public static object StringList(string name, string property)
    {
        var properties = new Dictionary<string, object> { [property] = new { type = "array", items = new { type = "string" } } };
        return Strict(name, properties, property);
    }

    // The answer format for an object with these properties, all of them required.
    private static object Strict(string name, object properties, string required)
    {
        return new
        {
            type = "json_schema",
            json_schema = new
            {
                name,
                strict = true,
                schema = new
                {
                    type = "object",
                    properties,
                    required = new[] { required },
                    additionalProperties = false
                }
            }
        };
    }
}
