using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// How many cards, decks and tags the user has, which the frontend shows in its navigation.
/// </summary>
[ApiController]
[Route("api/counts")]
public class CountsController(FlashCardDbContext dbContext) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<CountsResponse>> Get()
    {
        return Ok(new CountsResponse(
            await dbContext.FlashCards.CountAsync(),
            await dbContext.Decks.CountAsync(),
            await dbContext.Tags.CountAsync()));
    }
}
