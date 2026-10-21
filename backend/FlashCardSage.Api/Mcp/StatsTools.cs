using System.ComponentModel;
using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using ModelContextProtocol.Server;

namespace FlashCardSage.Api.Mcp;

/// <summary>
/// The read-only MCP tools for how many cards the user has and how well they know them, scored as the Scores page
/// scores them (see FlashCardScoring).
/// </summary>
[McpServerToolType]
public class StatsTools(PracticeService practiceService, CountsService countsService)
{
    public const int DefaultStatsPageSize = 100;

    public const int MaxStatsPageSize = 500;

    public const int DefaultHistorySize = 20;

    public const int MaxHistorySize = 200;

    [McpServerTool(Name = "get_counts", Title = "Count cards, decks and tags", ReadOnly = true, OpenWorld = false)]
    [Description("Counts the user's flash cards, decks and tags.")]
    public async Task<Counts> GetCountsAsync()
    {
        var counts = await countsService.GetAsync();
        return new Counts(counts.Cards, counts.Decks, counts.Tags);
    }

    [McpServerTool(Name = "get_practice_stats", Title = "Get practice scores", ReadOnly = true, OpenWorld = false)]
    [Description("Gets the practice score (0 to 100) and answer counts of the user's cards, lowest score first, a page at a time: all of them, a deck's, a tag's, or the ones given.")]
    public async Task<PracticeStats> GetPracticeStatsAsync(
        [Description("Only cards in this deck.")] int? deckId = null,
        [Description("Only cards with this tag. Give a deck or a tag, not both.")] int? tagId = null,
        [Description("Only these cards.")] int[]? cardIds = null,
        [Description("How many cards to return, 1 to 500. Defaults to 100.")] int? limit = null,
        [Description("How many cards to skip, for the next page.")] int? offset = null)
    {
        var selection = new PracticeSelection { DeckId = deckId, TagId = tagId };
        if (deckId is not null && tagId is not null)
        {
            throw ToolErrors.Error("Practice a deck or a tag, not both.");
        }

        var scores = await practiceService.ScoreAsync(selection)
            ?? throw ToolErrors.Error(deckId is null ? ToolErrors.TagNotFound : ToolErrors.DeckNotFound);
        if (cardIds is { Length: > 0 })
        {
            var wanted = cardIds.ToHashSet();
            scores = [.. scores.Where(score => wanted.Contains(score.Id))];
        }

        var skip = Math.Max(offset ?? 0, 0);
        var take = Math.Clamp(limit ?? DefaultStatsPageSize, 1, MaxStatsPageSize);
        var page = scores
            .OrderBy(score => score.Score)
            .ThenBy(score => score.Id)
            .Skip(skip)
            .Take(take)
            .Select(CardStats.From)
            .ToList();

        return new PracticeStats(
            scores.Sum(score => score.Score),
            scores.Count * PracticeScore.Maximum,
            scores.Count,
            skip,
            skip + page.Count < scores.Count,
            page);
    }

    [McpServerTool(Name = "get_practice_history", Title = "Get a card's practice history", ReadOnly = true, OpenWorld = false)]
    [Description("Gets how the user answered a card each time they practiced it, newest first, and its score.")]
    public async Task<PracticeHistory> GetPracticeHistoryAsync(
        [Description("The card's id.")] int cardId,
        [Description("How many answers to return, 1 to 200. Defaults to 20.")] int? limit = null)
    {
        var history = await practiceService.GetHistoryAsync(cardId)
            ?? throw ToolErrors.Error(ToolErrors.CardNotFound);
        var attempts = history
            .Select(result => new PracticeAttempt(result.Outcome, result.PracticedAt))
            .ToList();

        return new PracticeHistory(
            cardId,
            PracticeScore.FromOutcomes(attempts.Select(attempt => attempt.Outcome)),
            attempts.Count,
            [.. attempts.Take(Math.Clamp(limit ?? DefaultHistorySize, 1, MaxHistorySize))]);
    }
}
