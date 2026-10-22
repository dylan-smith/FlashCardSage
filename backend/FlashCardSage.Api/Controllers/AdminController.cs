using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts.Admin;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// Read-only views of how everyone uses the app, for the admins in Admin:Users only: totals, the people using it, and
/// one person's decks, tags, practice, connected apps, preferences and cards.
/// </summary>
[ApiController]
[Authorize(Policy = AuthenticationSetup.AdminPolicy)]
[Route("api/admin")]
public class AdminController(AdminService adminService) : ControllerBase
{
    [HttpGet("overview")]
    public async Task<ActionResult<AdminOverviewResponse>> GetOverview(CancellationToken cancellationToken)
    {
        return Ok(await adminService.GetOverviewAsync(cancellationToken));
    }

    [HttpGet("users")]
    public async Task<ActionResult<IEnumerable<AdminUserSummary>>> GetUsers(CancellationToken cancellationToken)
    {
        return Ok(await adminService.ListUsersAsync(cancellationToken));
    }

    [HttpGet("users/{id:int}")]
    public async Task<ActionResult<AdminUserDetail>> GetUser(int id, CancellationToken cancellationToken)
    {
        var user = await adminService.GetUserAsync(id, cancellationToken);
        return user is null ? NotFound() : Ok(user);
    }

    [HttpGet("users/{id:int}/cards")]
    public async Task<ActionResult<IEnumerable<AdminCardSummary>>> GetUserCards(int id, CancellationToken cancellationToken)
    {
        var cards = await adminService.ListUserCardsAsync(id, cancellationToken);
        return cards is null ? NotFound() : Ok(cards);
    }
}
