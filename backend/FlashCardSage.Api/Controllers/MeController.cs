using FlashCardSage.Api.Admin;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

/// <summary>
/// The signed-in user, so the frontend can check a saved sign-in is still good and whether to show the admin pages.
/// </summary>
[ApiController]
[Route("api/me")]
public class MeController(AdminUsers adminUsers, AccountService accountService) : ControllerBase
{
    // Deletes the signed-in user's account and everything in it, which can't be undone.
    [HttpDelete]
    public async Task<IActionResult> Delete()
    {
        await accountService.DeleteAsync();
        return NoContent();
    }

    [HttpGet]
    public ActionResult<MeResponse> Get()
    {
        return Ok(new MeResponse(
            User.FindFirst(AuthenticationSetup.NameClaim)?.Value,
            User.FindFirst(AuthenticationSetup.EmailClaim)?.Value,
            adminUsers.Contains(User)));
    }
}
