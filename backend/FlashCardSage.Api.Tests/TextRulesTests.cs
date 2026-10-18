using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Tests;

public class TextRulesTests
{
    [Theory]
    [InlineData("el gato", "El Gato", true)]
    [InlineData("único", "ÚNICO", true)]
    [InlineData("el gato", "el gato ", false)]
    [InlineData("el gato", "el perro", false)]
    [InlineData(null, null, true)]
    [InlineData("el gato", null, false)]
    public void SameText_IgnoresCaseOnly(string? a, string? b, bool expected)
    {
        Assert.Equal(expected, TextRules.SameText(a, b));
    }

    [Theory]
    [InlineData("  el gato ", "el gato")]
    [InlineData("   ", "")]
    [InlineData(null, "")]
    public void Clean_TrimsAndTurnsNullIntoEmpty(string? text, string expected)
    {
        Assert.Equal(expected, TextRules.Clean(text));
    }

    [Fact]
    public void CleanWords_TrimsAndLeavesOutBlanks_KeepingRepeatsWithoutDedupe()
    {
        var words = TextRules.CleanWords([" solo ", "", null, "únicamente", "SOLO", "   "], dedupe: false);

        Assert.Equal(["solo", "únicamente", "SOLO"], words);
    }

    [Fact]
    public void CleanWords_KeepsTheFirstOfEachRepeatIgnoringCase_WithDedupe()
    {
        var words = TextRules.CleanWords([" solo ", "", null, "únicamente", "SOLO", "   "], dedupe: true);

        Assert.Equal(["solo", "únicamente"], words);
    }

    [Fact]
    public void Comparer_IgnoresCase()
    {
        var names = new HashSet<string>(["Food"], TextRules.Comparer);

        Assert.Contains("FOOD", names);
        Assert.DoesNotContain("Foods", names);
    }
}
