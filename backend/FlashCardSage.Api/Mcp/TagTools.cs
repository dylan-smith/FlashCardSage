using System.ComponentModel;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Services;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Server;

namespace FlashCardSage.Api.Mcp;

/// <summary>
/// The MCP tools for the user's tags, through TagService as the Tags page does. Tags are also made by putting a new
/// name on a card (see CardTools).
/// </summary>
[McpServerToolType]
public class TagTools(FlashCardDbContext dbContext, TagService tags)
{
    [McpServerTool(Name = "list_tags", Title = "List tags", ReadOnly = true, OpenWorld = false)]
    [Description("Lists the user's tags by name, with how many cards each is on.")]
    public async Task<IReadOnlyList<TagSummary>> ListTagsAsync()
    {
        return await dbContext.Tags
            .AsNoTracking()
            .OrderBy(tag => tag.Name)
            .Select(tag => new TagSummary(tag.Id, tag.Name, tag.FlashCards.Count))
            .ToListAsync();
    }

    [McpServerTool(Name = "create_tag", Title = "Add a tag", Destructive = false, Idempotent = false, OpenWorld = false)]
    [Description("Adds a tag with no cards yet. Names are unique ignoring case and up to 50 characters.")]
    public async Task<TagSummary> CreateTagAsync([Description("The tag's name.")] string name)
    {
        var result = await tags.CreateAsync(name ?? string.Empty);

        return result is TagResult.Saved(var tag) ? new TagSummary(tag.Id, tag.Name, 0) : throw ToolErrors.For(result);
    }

    [McpServerTool(Name = "rename_tag", Title = "Rename a tag", Destructive = false, Idempotent = true, OpenWorld = false)]
    [Description("Renames a tag, keeping it on its cards.")]
    public async Task<TagSummary> RenameTagAsync(
        [Description("The tag's id.")] int id,
        [Description("The tag's new name.")] string name)
    {
        var result = await tags.RenameAsync(id, name ?? string.Empty);
        if (result is not TagResult.Saved(var tag))
        {
            throw ToolErrors.For(result);
        }

        var cardCount = await dbContext.FlashCards.CountAsync(card => card.Tags.Any(item => item.Id == id));
        return new TagSummary(tag.Id, tag.Name, cardCount);
    }

    [McpServerTool(Name = "delete_tag", Title = "Delete a tag", Destructive = true, Idempotent = true, OpenWorld = false)]
    [Description("Deletes a tag, taking it off its cards, which are kept. With replaceWithTagId, that other tag is put on the cards first, which merges the two tags.")]
    public async Task<string> DeleteTagAsync(
        [Description("The tag's id.")] int id,
        [Description("Another of the user's tags to put on the deleted tag's cards.")] int? replaceWithTagId = null)
    {
        var result = await tags.DeleteAsync(id, replaceWithTagId);

        return result is TagResult.Deleted ? "Deleted the tag." : throw ToolErrors.For(result);
    }
}
