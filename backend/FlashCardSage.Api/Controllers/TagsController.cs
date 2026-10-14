using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The user's tags. A tag is made here or by putting a new name on a card (see FlashCardsController), and here it
/// can be renamed or deleted.
/// </summary>
/// <remarks>
/// Like FlashCardsController, log statements include ids only, never a tag's name.
/// </remarks>
[ApiController]
[Route("api/tags")]
public class TagsController(FlashCardDbContext dbContext, ILogger<TagsController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<Tag>>> GetAll()
    {
        logger.LogInformation("Retrieving all tags");

        var tags = await dbContext.Tags
            .AsNoTracking()
            .OrderBy(tag => tag.Name)
            .ToListAsync();

        logger.LogInformation("Retrieved {Count} tags", tags.Count);

        return Ok(tags);
    }

    // A tag with no cards yet. There's no route to read one tag, so the 201 has no Location.
    [HttpPost]
    public async Task<ActionResult<Tag>> Create([FromBody] TagRequest request)
    {
        var tags = await dbContext.Tags.ToListAsync();
        var name = ValidateName(request.Name, tags, id: null);
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        var tag = new Tag { Name = name };
        dbContext.Tags.Add(tag);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Created tag {TagId}", tag.Id);

        return StatusCode(StatusCodes.Status201Created, tag);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<Tag>> Update(int id, [FromBody] TagRequest request)
    {
        var tags = await dbContext.Tags.ToListAsync();
        var tag = tags.FirstOrDefault(item => item.Id == id);

        if (tag is null)
        {
            logger.LogWarning("Tag {TagId} not found for update", id);
            return NotFound();
        }

        var name = ValidateName(request.Name, tags, id);
        if (!ModelState.IsValid)
        {
            return ValidationProblem(ModelState);
        }

        tag.Name = name;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Renamed tag {TagId}", id);

        return Ok(tag);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        // The tag's cards are loaded so EF removes the tag from them first, which the database leaves to it.
        var tag = await dbContext.Tags
            .Include(item => item.FlashCards)
            .FirstOrDefaultAsync(item => item.Id == id);

        if (tag is null)
        {
            logger.LogWarning("Tag {TagId} not found for deletion", id);
            return NotFound();
        }

        dbContext.Tags.Remove(tag);
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Deleted tag {TagId}", id);

        return NoContent();
    }

    // The trimmed name, adding a model error if it's blank or another of the user's tags (not the one with this id)
    // has it. A person's tags are few, so they're matched here rather than in SQL.
    private string ValidateName(string name, List<Tag> tags, int? id)
    {
        var trimmed = name.Trim();

        if (trimmed.Length == 0)
        {
            ModelState.AddModelError(nameof(TagRequest.Name), "Tag name is required.");
        }
        // Names are unique whatever their case, as the database's index is.
        else if (tags.Any(item => item.Id != id && string.Equals(item.Name, trimmed, StringComparison.OrdinalIgnoreCase)))
        {
            ModelState.AddModelError(nameof(TagRequest.Name), "There's already a tag with that name.");
        }

        return trimmed;
    }
}
