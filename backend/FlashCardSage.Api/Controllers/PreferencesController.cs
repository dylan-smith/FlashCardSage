using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The signed-in user's preferences, which the frontend follows: whether cards' pictures are shown, whether new
/// cards are suggested, and whether a card's sides are translated as the user types.
/// </summary>
[ApiController]
[Route("api/preferences")]
public class PreferencesController(
    FlashCardDbContext dbContext,
    CurrentUser currentUser,
    ILogger<PreferencesController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PreferencesResponse>> Get()
    {
        var user = await dbContext.Users
            .AsNoTracking()
            .SingleAsync(item => item.Id == currentUser.UserId);

        return Ok(ToResponse(user));
    }

    [HttpPut]
    public async Task<ActionResult<PreferencesResponse>> Update([FromBody] PreferencesRequest request)
    {
        var user = await dbContext.Users.SingleAsync(item => item.Id == currentUser.UserId);

        user.ShowPictures = request.ShowPictures!.Value;
        user.ShowSuggestions = request.ShowSuggestions!.Value;
        user.AutoTranslate = request.AutoTranslate!.Value;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Updated user {UserId}'s preferences", user.Id);

        return Ok(ToResponse(user));
    }

    private static PreferencesResponse ToResponse(User user)
    {
        return new PreferencesResponse(user.ShowPictures, user.ShowSuggestions, user.AutoTranslate);
    }
}
