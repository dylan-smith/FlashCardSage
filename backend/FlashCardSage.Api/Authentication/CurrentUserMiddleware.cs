using System.Diagnostics;
using System.Globalization;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Usage;

namespace FlashCardSage.Api.Authentication;

/// <summary>
/// Finds the signed-in user's row, creating it on their first request, and makes it the request's
/// <see cref="CurrentUser"/>. A person's requests are tagged with their user ID, which Application Insights shows as the
/// authenticated user so the FlashCardSage Usage workbook can count active users, and each one may take a usage snapshot.
/// </summary>
public class CurrentUserMiddleware(RequestDelegate next)
{
    // The OpenTelemetry attribute the Azure Monitor exporter sends as the authenticated user ID.
    public const string UserIdTag = "enduser.id";

    public async Task InvokeAsync(
        HttpContext context,
        FlashCardDbContext dbContext,
        CurrentUser currentUser,
        UsageSnapshotService usageSnapshots,
        TimeProvider timeProvider)
    {
        if (context.User.FindFirst(AuthenticationSetup.SubjectClaim)?.Value is { } subject)
        {
            var name = context.User.FindFirst(AuthenticationSetup.NameClaim)?.Value;
            var email = context.User.FindFirst(AuthenticationSetup.EmailClaim)?.Value;
            currentUser.UserId = await UserAccounts.GetOrCreateUserIdAsync(
                dbContext, subject, name, email, timeProvider.GetUtcNow(), context.RequestAborted);

            if (UsageSnapshot.IsPerson(subject))
            {
                Activity.Current?.SetTag(UserIdTag, currentUser.UserId.Value.ToString(CultureInfo.InvariantCulture));
                usageSnapshots.RequestSnapshot();
            }
        }

        await next(context);
    }
}
