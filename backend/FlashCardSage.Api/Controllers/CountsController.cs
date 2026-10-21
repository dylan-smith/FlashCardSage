using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// How many cards, decks and tags the user has, which the frontend shows in its navigation.
/// </summary>
[ApiController]
[Route("api/counts")]
public class CountsController(CountsService countsService) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<CountsResponse>> Get()
    {
        return Ok(await countsService.GetAsync());
    }
}
