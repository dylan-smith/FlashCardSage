using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// A language a card's side is written in, sent by name.
[JsonConverter(typeof(JsonStringEnumConverter<Language>))]
public enum Language
{
    Spanish = 1,
    English = 2
}
