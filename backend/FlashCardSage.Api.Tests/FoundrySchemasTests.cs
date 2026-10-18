using System.Text.Json;
using FlashCardSage.Api.Suggestions.Foundry;

namespace FlashCardSage.Api.Tests;

public class FoundrySchemasTests
{
    [Fact]
    public void Cards_IsAStrictSchemaForAListOfCards()
    {
        var json = JsonSerializer.Serialize(FoundrySchemas.Cards("card_suggestions"));

        Assert.Equal(
            Json("{'type':'json_schema','json_schema':{'name':'card_suggestions','strict':true,'schema':{'type':'object',"
                + "'properties':{'cards':{'type':'array','items':{'type':'object','properties':{'spanish':{'type':'string'},"
                + "'english':{'type':'string'}},'required':['spanish','english'],'additionalProperties':false}}},"
                + "'required':['cards'],'additionalProperties':false}}}"),
            json);
    }

    [Fact]
    public void StringList_IsAStrictSchemaForAListOfStrings_UnderTheProperty()
    {
        var json = JsonSerializer.Serialize(FoundrySchemas.StringList("tag_suggestions", "tags"));

        Assert.Equal(
            Json("{'type':'json_schema','json_schema':{'name':'tag_suggestions','strict':true,'schema':{'type':'object',"
                + "'properties':{'tags':{'type':'array','items':{'type':'string'}}},'required':['tags'],"
                + "'additionalProperties':false}}}"),
            json);
    }

    // JSON written with single quotes, so it reads more easily in a C# string.
    private static string Json(string text)
    {
        return text.Replace('\'', '"');
    }
}
