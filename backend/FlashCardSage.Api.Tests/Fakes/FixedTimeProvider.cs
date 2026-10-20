namespace FlashCardSage.Api.Tests.Fakes;

// A clock that only moves when a test moves it.
internal sealed class FixedTimeProvider(DateTimeOffset now) : TimeProvider
{
    public FixedTimeProvider()
        : this(new DateTimeOffset(2026, 10, 20, 9, 0, 0, TimeSpan.Zero))
    {
    }

    public DateTimeOffset Now { get; set; } = now;

    public void Advance(TimeSpan by)
    {
        Now += by;
    }

    public override DateTimeOffset GetUtcNow()
    {
        return Now;
    }
}
