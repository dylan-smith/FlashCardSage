using Microsoft.Extensions.Logging;

namespace FlashCardSage.Api.Tests.Fakes;

// Keeps every message logged, with the values it was logged with by name, as they reach Application Insights.
internal sealed class RecordingLogger<T> : ILogger<T>
{
    public List<IReadOnlyDictionary<string, object?>> Entries { get; } = [];

    public IDisposable? BeginScope<TState>(TState state)
        where TState : notnull
    {
        return null;
    }

    public bool IsEnabled(LogLevel logLevel)
    {
        return true;
    }

    public void Log<TState>(
        LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
    {
        var values = state is IEnumerable<KeyValuePair<string, object?>> pairs
            ? pairs.ToDictionary(pair => pair.Key, pair => pair.Value)
            : new Dictionary<string, object?>();
        values["Message"] = formatter(state, exception);
        Entries.Add(values);
    }
}
