using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// The signed-in user's preferences (see PreferencesController).
/// </summary>
public class PreferencesService(
    FlashCardDbContext dbContext,
    CurrentUser currentUser,
    ILogger<PreferencesService> logger)
{
    // The signed-in user, whose preferences are on it.
    public Task<User> GetAsync()
    {
        return dbContext.Users
            .AsNoTracking()
            .SingleAsync(item => item.Id == currentUser.UserId);
    }

    // Saves the signed-in user's preferences, returning the user with them.
    public async Task<User> UpdateAsync(bool showPictures, bool showSuggestions, bool autoTranslate, bool showGettingStarted)
    {
        var user = await dbContext.Users.SingleAsync(item => item.Id == currentUser.UserId);

        user.ShowPictures = showPictures;
        user.ShowSuggestions = showSuggestions;
        user.AutoTranslate = autoTranslate;
        user.ShowGettingStarted = showGettingStarted;
        await dbContext.SaveChangesAsync();

        logger.LogInformation("Updated user {UserId}'s preferences", user.Id);

        return user;
    }
}
