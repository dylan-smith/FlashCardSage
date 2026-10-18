namespace FlashCardSage.Api.Models;

// Putting the user's tags on cards by name. Names match whatever their case, as they do in the database, so "food"
// goes on the user's "Food" tag. A person's tags are few, so they're matched in memory rather than in SQL.
public static class TagList
{
    // The tag with this name, or a new one, which is added to the tags so other cards being added with it use it too.
    public static Tag FindOrAdd(this List<Tag> tags, string name)
    {
        ArgumentNullException.ThrowIfNull(tags);

        var tag = tags.FirstOrDefault(item => TextRules.SameText(item.Name, name));
        if (tag is null)
        {
            tag = new Tag { Name = name };
            tags.Add(tag);
        }

        return tag;
    }

    // In name order, ignoring case, as a card's tags are shown.
    public static List<Tag> OrderedByName(this IEnumerable<Tag> tags)
    {
        return tags.OrderBy(tag => tag.Name, TextRules.Comparer).ToList();
    }
}
