using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Counts the user's cards, decks and tags (see CountsController).
/// </summary>
public class CountsService(FlashCardDbContext dbContext)
{
    // How many cards, decks and tags the user has.
    public async Task<CountsResponse> GetAsync()
    {
        return new CountsResponse(
            await dbContext.FlashCards.CountAsync(),
            await dbContext.Decks.CountAsync(),
            await dbContext.Tags.CountAsync());
    }
}
