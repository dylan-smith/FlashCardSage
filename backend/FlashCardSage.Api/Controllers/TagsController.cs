using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The user's tags. A tag is made here or by putting a new name on a card (see FlashCardsController), and here it
/// can be renamed or deleted, optionally replacing it with another tag on its cards.
/// </summary>
/// <remarks>
/// Like FlashCardsController, log statements include ids only, never a tag's name. The changes are made by TagService,
/// and this turns what became of them into responses.
/// </remarks>
[ApiController]
[Route("api/tags")]
public class TagsController(FlashCardDbContext dbContext, TagService tagService, ILogger<TagsController> logger)
    : ControllerBase
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
        return ToResponse(await tagService.CreateAsync(request.Name), created: true);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<Tag>> Update(int id, [FromBody] TagRequest request)
    {
        return ToResponse(await tagService.RenameAsync(id, request.Name));
    }

    // With replaceWith, that other tag of the user's is put on the deleted tag's cards first, which merges the two.
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, [FromQuery] int? replaceWith = null)
    {
        return ToResponse(await tagService.DeleteAsync(id, replaceWith));
    }

    // The response for what became of a change, a 201 for a saved tag that's new.
    private ActionResult ToResponse(TagResult result, bool created = false)
    {
        switch (result)
        {
            case TagResult.Saved(var tag):
                return created ? StatusCode(StatusCodes.Status201Created, tag) : Ok(tag);
            case TagResult.Deleted:
                return NoContent();
            case TagResult.NotFound:
                return NotFound();
            case TagResult.Invalid(var errors):
                foreach (var (field, message) in errors)
                {
                    ModelState.AddModelError(field, message);
                }

                return ValidationProblem(ModelState);
            default:
                throw new InvalidOperationException($"Unexpected tag result {result.GetType().Name}.");
        }
    }
}
