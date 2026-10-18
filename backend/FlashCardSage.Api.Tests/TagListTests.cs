using FlashCardSage.Api.Models;

namespace FlashCardSage.Api.Tests;

public class TagListTests
{
    [Fact]
    public void FindOrAdd_FindsTheTagWhateverItsCase()
    {
        var food = new Tag { Id = 1, Name = "Food" };
        var tags = new List<Tag> { food, new() { Id = 2, Name = "Travel" } };

        var found = tags.FindOrAdd("FOOD");

        Assert.Same(food, found);
        Assert.Equal(2, tags.Count);
    }

    [Fact]
    public void FindOrAdd_AddsANewTag_WhichTheNextCallFinds()
    {
        var tags = new List<Tag> { new() { Id = 1, Name = "Food" } };

        var added = tags.FindOrAdd("Animals");
        var again = tags.FindOrAdd("animals");

        Assert.Equal(("Animals", 0), (added.Name, added.Id));
        Assert.Same(added, again);
        Assert.Equal(["Food", "Animals"], tags.Select(tag => tag.Name));
    }

    [Fact]
    public void OrderedByName_IgnoresCase()
    {
        var tags = new[] { new Tag { Name = "travel" }, new Tag { Name = "Animals" }, new Tag { Name = "food" } };

        Assert.Equal(["Animals", "food", "travel"], tags.OrderedByName().Select(tag => tag.Name));
    }
}
