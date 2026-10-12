namespace FlashCardSage.Api.Models;

// How well the user knows a card, out of 100, from how many times in a row they've got it right in practice.
public static class PracticeScore
{
    public const int Maximum = 100;

    // The score for 0, 1, 2, 3, 4 and 5 or more correct answers in a row.
    private static readonly int[] ScoresByStreak = [0, 50, 80, 90, 95, Maximum];

    // The longest run that still raises the score.
    public static int MaximumStreak => ScoresByStreak.Length - 1;

    public static int FromStreak(int correctInARow)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(correctInARow);
        return ScoresByStreak[Math.Min(correctInARow, MaximumStreak)];
    }
}
