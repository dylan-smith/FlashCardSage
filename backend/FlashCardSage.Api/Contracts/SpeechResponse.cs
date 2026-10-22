namespace FlashCardSage.Api.Contracts;

// Where to play each text's audio from, in the order the texts were sent.
public record SpeechResponse(IReadOnlyList<string> Urls);
