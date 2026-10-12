using System.Text.Json.Serialization;

namespace FlashCardSage.Api.Models;

// How the user did when they practiced a card. Sent and stored by name, so the values can be reordered.
[JsonConverter(typeof(JsonStringEnumConverter<PracticeOutcome>))]
public enum PracticeOutcome
{
    GotIt = 1,
    WasClose = 2,
    Failed = 3
}
