using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Services;

/// <summary>
/// Counts the user's cards, decks, tags and practice answers (see CountsController).
/// </summary>
public class CountsService(FlashCardDbContext dbContext)
{
    // How many cards, decks and tags the user has, and how many answers they've given in practice (the results are
    // filtered to the user's cards).
    public async Task<CountsResponse> GetAsync()
    {
        return new CountsResponse(
            await dbContext.FlashCards.CountAsync(),
            await dbContext.Decks.CountAsync(),
            await dbContext.Tags.CountAsync(),
            await dbContext.PracticeResults.CountAsync());
    }
}
