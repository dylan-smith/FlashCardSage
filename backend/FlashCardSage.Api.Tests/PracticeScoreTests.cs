using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Tests;

public class PracticeScoreTests
{
    [Theory]
    [InlineData(0, 0)]
    [InlineData(1, 50)]
    [InlineData(2, 80)]
    [InlineData(3, 90)]
    [InlineData(4, 95)]
    [InlineData(5, 100)]
    [InlineData(6, 100)]
    public void FromStreak_ScoresEachRunOfCorrectAnswers(int correctInARow, int expected)
    {
        Assert.Equal(expected, PracticeScore.FromStreak(correctInARow));
    }
}
