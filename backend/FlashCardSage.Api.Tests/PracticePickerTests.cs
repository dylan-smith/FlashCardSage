using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Tests;

public class PracticePickerTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 12, 12, 0, 0, TimeSpan.Zero);

    private static readonly FlashCardScore Cat = new(1, ["el gato"], ["the cat"], 0, null, null);
    private static readonly FlashCardScore Dog = new(2, ["el perro"], ["the dog"], 0, null, null);
    private static readonly FlashCardScore House = new(3, ["la casa"], ["the house"], 0, null, null);

    [Theory]
    [InlineData(0, null, 100)]
    [InlineData(90, null, 10)]
    [InlineData(100, 0.0, 0)]
    [InlineData(100, 7.0, 7)]
    [InlineData(100, 0.5, 0.5)]
    [InlineData(90, 3.0, 13)]
    [InlineData(50, 80.0, 100)]
    [InlineData(100, 150.0, 100)]
    public void Weight_GrowsAsTheScoreFallsAndWithEachDaySincePracticed(
        int score, double? daysAgo, double expected)
    {
        var card = Cat with { Score = score, LastPracticedAt = daysAgo is { } days ? Now.AddDays(-days) : null };

        Assert.Equal(expected, PracticePicker.Weight(card, Now), precision: 9);
    }

    [Fact]
    public void Pick_FavoursTheCardWithTheLowerScore()
    {
        // Weights 100 and 10, so 0.85 of the way is still the first card, where an even pick would be the second.
        var next = PracticePicker.Pick([Cat, Dog with { Score = 90 }], null, Now, 0.85, 0);

        Assert.Equal(Cat.Id, next?.Id);
    }

    [Theory]
    [InlineData(0.0, 1)]
    [InlineData(0.49, 1)]
    [InlineData(0.51, 2)]
    [InlineData(0.99, 2)]
    public void Pick_ChoosesInProportionToTheWeights(double cardRoll, int expectedId)
    {
        var next = PracticePicker.Pick([Cat, Dog], null, Now, cardRoll, 0);

        Assert.Equal(expectedId, next?.Id);
    }

    [Fact]
    public void Pick_LeavesOutACardWithTheMaximumScorePracticedJustNow()
    {
        var next = PracticePicker.Pick([Cat with { Score = 100, LastPracticedAt = Now }, Dog], null, Now, 0, 0);

        Assert.Equal(Dog.Id, next?.Id);
    }

    [Theory]
    [InlineData(50, 1)]
    [InlineData(10, 2)]
    public void Pick_GivesACardWithTheMaximumScoreMoreChanceTheLongerSincePracticed(int daysAgo, int expectedId)
    {
        // A weight of one for each day, against 50 for the other card.
        var cards = new[] { Cat with { Score = 100, LastPracticedAt = Now.AddDays(-daysAgo) }, Dog with { Score = 50 } };

        var next = PracticePicker.Pick(cards, null, Now, 0.45, 0);

        Assert.Equal(expectedId, next?.Id);
    }

    [Fact]
    public void Pick_LeavesOutTheCardJustPracticed()
    {
        var next = PracticePicker.Pick([Cat, Dog, House], Cat.Id, Now, 0, 0);

        Assert.Equal(Dog.Id, next?.Id);
    }

    [Fact]
    public void Pick_KeepsTheOnlyCard()
    {
        var next = PracticePicker.Pick([Cat with { Score = 100, LastPracticedAt = Now }], Cat.Id, Now, 0.5, 0);

        Assert.Equal(Cat.Id, next?.Id);
    }

    [Fact]
    public void Pick_ChoosesEvenly_WhenNoCardHasAnyWeight()
    {
        var mastered = new[]
        {
            Cat with { Score = 100, LastPracticedAt = Now },
            Dog with { Score = 100, LastPracticedAt = Now }
        };

        Assert.Equal(Cat.Id, PracticePicker.Pick(mastered, null, Now, 0.4, 0)?.Id);
        Assert.Equal(Dog.Id, PracticePicker.Pick(mastered, null, Now, 0.6, 0)?.Id);
    }

    [Theory]
    [InlineData(0.0, PracticeSide.Spanish)]
    [InlineData(0.49, PracticeSide.Spanish)]
    [InlineData(0.5, PracticeSide.English)]
    [InlineData(0.99, PracticeSide.English)]
    public void Pick_ShowsEitherSideFirst(double sideRoll, PracticeSide expected)
    {
        var next = PracticePicker.Pick([Cat], null, Now, 0, sideRoll);

        Assert.Equivalent(new PracticeCard(Cat.Id, ["el gato"], ["the cat"], expected, null), next);
    }

    [Fact]
    public void Pick_ReturnsNull_WhenThereAreNoCards()
    {
        Assert.Null(PracticePicker.Pick([], null, Now, 0, 0));
    }
}
