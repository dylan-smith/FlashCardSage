using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// The side of a card the user is shown first in practice, sent by name.
[JsonConverter(typeof(JsonStringEnumConverter<PracticeSide>))]
public enum PracticeSide
{
    Spanish = 1,
    English = 2
}
