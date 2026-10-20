using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Makes, renames and deletes the user's tags (see TagsController). A tag is also made by putting a new name on a card
/// (see FlashCardService), and deleting one can put another tag on its cards instead.
/// </summary>
/// <remarks>
/// Log statements include ids only, never a tag's name.
/// </remarks>
public class TagService(FlashCardDbContext dbContext, ILogger<TagService> logger)
{
    // The user's tags, by name.
    public Task<List<Tag>> GetAllAsync()
    {
        return dbContext.Tags
            .AsNoTracking()
            .OrderBy(tag => tag.Name)
            .ToListAsync();
    }

    // A tag with no cards yet.
    public async Task<TagResult> CreateAsync(string name)
    {
        var tags = await dbContext.Tags.ToListAsync();
        var errors = new List<KeyValuePair<string, string>>();
        var trimmed = ValidateName(name, tags, id: null, errors);
        if (errors.Count > 0)
        {
            return new TagResult.Invalid(errors);
        }

        var tag = new Tag { Name = trimmed };
        dbContext.Tags.Add(tag);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created tag {TagId}", tag.Id);

        return new TagResult.Saved(tag);
    }

    public async Task<TagResult> RenameAsync(int id, string name)
    {
        var tags = await dbContext.Tags.ToListAsync();
        var tag = tags.FirstOrDefault(item => item.Id == id);

        if (tag is null)
        {
            logger.LogWarning("Tag {TagId} not found for update", id);
            return new TagResult.NotFound();
        }

        var errors = new List<KeyValuePair<string, string>>();
        var trimmed = ValidateName(name, tags, id, errors);
        if (errors.Count > 0)
        {
            return new TagResult.Invalid(errors);
        }

        tag.Name = trimmed;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Renamed tag {TagId}", id);

        return new TagResult.Saved(tag);
    }

    // With replaceWith, that other tag of the user's is put on the deleted tag's cards first, which merges the two.
    public async Task<TagResult> DeleteAsync(int id, int? replaceWith)
    {
        // The tag's cards are loaded so EF removes the tag from them first, which the database leaves to it.
        var tag = await dbContext.Tags
            .Include(item => item.FlashCards)
            .FirstOrDefaultAsync(item => item.Id == id);

        if (tag is null)
        {
            logger.LogWarning("Tag {TagId} not found for deletion", id);
            return new TagResult.NotFound();
        }

        if (replaceWith is int replacementId)
        {
            // The query filter means another user's tag isn't found, the same as one that doesn't exist.
            var replacement = replacementId == id
                ? null
                : await dbContext.Tags
                    .Include(item => item.FlashCards)
                    .FirstOrDefaultAsync(item => item.Id == replacementId);

            if (replacement is null)
            {
                return new TagResult.Invalid(
                    [new(nameof(replaceWith), "Pick another of your tags to replace it with.")]);
            }

            foreach (var card in tag.FlashCards.Where(card => !replacement.FlashCards.Contains(card)))
            {
                replacement.FlashCards.Add(card);
            }

            logger.LogInformation("Replacing tag {TagId} with tag {ReplacementTagId}", id, replacementId);
        }

        dbContext.Tags.Remove(tag);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted tag {TagId}", id);

        return new TagResult.Deleted();
    }

    // The trimmed name, adding an error if it's blank or another of the user's tags (not the one with this id) has it.
    // A person's tags are few, so they're matched here rather than in SQL.
    private static string ValidateName(
        string name, List<Tag> tags, int? id, List<KeyValuePair<string, string>> errors)
    {
        var trimmed = name.Trim();

        if (trimmed.Length == 0)
        {
            errors.Add(new("Name", "Tag name is required."));
        }
        // Names are unique whatever their case, as the database's index is.
        else if (tags.Any(item => item.Id != id && TextRules.SameText(item.Name, trimmed)))
        {
            errors.Add(new("Name", "There's already a tag with that name."));
        }

        return trimmed;
    }
}
