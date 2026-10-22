using System.Security.Claims;
using FlashCardSage.Api.Authentication;

namespace FlashCardSage.Api.Admin;

/// <summary>
/// The users who may use the admin endpoints, from Admin:Users. Each entry is a user's email or subject (e.g.
/// "google:&lt;sub&gt;" or "test:admin"), compared ignoring case. With none, nobody is an admin.
/// </summary>
public sealed class AdminUsers(IReadOnlyCollection<string> entries)
{
    public int Count => entries.Count;

    public static AdminUsers FromConfiguration(IConfiguration configuration)
    {
        ArgumentNullException.ThrowIfNull(configuration);

        return new AdminUsers(configuration
            .GetSection("Admin:Users")
            .GetChildren()
            .Select(entry => entry.Value?.Trim())
            .OfType<string>()
            .Where(entry => entry.Length > 0)
            .ToArray());
    }

    public bool Contains(ClaimsPrincipal user)
    {
        ArgumentNullException.ThrowIfNull(user);

        if (user.Identity?.IsAuthenticated != true)
        {
            return false;
        }

        var subject = user.FindFirstValue(AuthenticationSetup.SubjectClaim);
        var email = user.FindFirstValue(AuthenticationSetup.EmailClaim);

        return entries.Any(entry =>
            string.Equals(entry, subject, StringComparison.OrdinalIgnoreCase)
            || string.Equals(entry, email, StringComparison.OrdinalIgnoreCase));
    }
}
