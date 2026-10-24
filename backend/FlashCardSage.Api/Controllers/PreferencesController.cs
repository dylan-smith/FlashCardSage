using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The signed-in user's preferences, which the frontend follows: whether cards' pictures are shown, whether new
/// cards are suggested, whether a card's sides are translated as the user types, and whether the Cards page shows the
/// getting started guide.
/// </summary>
[ApiController]
[Route("api/preferences")]
public class PreferencesController(PreferencesService preferencesService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<PreferencesResponse>> Get()
    {
        return Ok(ToResponse(await preferencesService.GetAsync()));
    }

    [HttpPut]
    public async Task<ActionResult<PreferencesResponse>> Update([FromBody] PreferencesRequest request)
    {
        var user = await preferencesService.UpdateAsync(
            request.ShowPictures!.Value,
            request.ShowSuggestions!.Value,
            request.AutoTranslate!.Value,
            request.ShowGettingStarted!.Value);

        return Ok(ToResponse(user));
    }

    private static PreferencesResponse ToResponse(User user)
    {
        return new PreferencesResponse(
            user.ShowPictures, user.ShowSuggestions, user.AutoTranslate, user.ShowGettingStarted);
    }
}
