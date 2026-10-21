using FlashCardSage.Api.Data;
using FlashCardSage.Api.Mcp;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using ModelContextProtocol;

namespace FlashCardSage.Api.Tests.Mcp;

public class TagToolsTests
{
    [Fact]
    public async Task ListTags_ReturnsTheUsersTagsByName_WithTheirCardCounts()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Pets", ids[0]);
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals", ids[0], ids[1]);
        await TestDb.SeedAsOtherUserAsync(databaseName, dbContext => dbContext.Tags.Add(new Tag { Name = "Theirs" }));
        await using var dbContext = TestDb.Create(databaseName);

        var tags = await CreateTools(dbContext).ListTagsAsync();

        Assert.Equal([("Animals", 2), ("Pets", 1)], tags.Select(tag => (tag.Name, tag.CardCount)));
    }

    [Fact]
    public async Task CreateTag_AddsATrimmedTag()
    {
        await using var dbContext = TestDb.Create();

        var tag = await CreateTools(dbContext).CreateTagAsync("  Food ");

        Assert.Equal(("Food", 0), (tag.Name, tag.CardCount));
        Assert.Equal("Food", (await dbContext.Tags.SingleAsync()).Name);
    }

    [Theory]
    [InlineData(" ", "Tag name is required.")]
    [InlineData("FOOD", "There's already a tag with that name.")]
    public async Task CreateTag_RefusesABlankOrTakenName(string name, string message)
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Food");
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).CreateTagAsync(name));

        Assert.Equal(message, error.Message);
    }

    [Fact]
    public async Task RenameTag_KeepsItsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"));
        var tagId = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Pets", ids[0]);
        await using var dbContext = TestDb.Create(databaseName);

        var tag = await CreateTools(dbContext).RenameTagAsync(tagId, "Animals");

        Assert.Equal(new TagSummary(tagId, "Animals", 1), tag);
    }

    [Fact]
    public async Task RenameTag_RefusesAnotherUsersTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        var otherId = await TestDb.SeedTagAsync(databaseName, TestDb.OtherUserId, "Theirs");
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).RenameTagAsync(otherId, "Mine"));

        Assert.Equal(ToolErrors.TagNotFound, error.Message);
    }

    [Fact]
    public async Task DeleteTag_PutsTheReplacementOnItsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        var ids = await TestDb.SeedCardsAsync(databaseName, TestDb.UserId, ("el gato", "the cat"), ("el perro", "the dog"));
        var petsId = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Pets", ids[0], ids[1]);
        var animalsId = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals", ids[1]);
        await using var dbContext = TestDb.Create(databaseName);
        var tools = CreateTools(dbContext);

        await tools.DeleteTagAsync(petsId, replaceWithTagId: animalsId);

        Assert.Equal([new TagSummary(animalsId, "Animals", 2)], await tools.ListTagsAsync());
        Assert.Equal(2, await dbContext.FlashCards.CountAsync());
    }

    [Fact]
    public async Task DeleteTag_RefusesItselfAsTheReplacement()
    {
        var databaseName = TestDb.NewDatabaseName();
        var tagId = await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Pets");
        await using var dbContext = TestDb.Create(databaseName);

        var error = await Assert.ThrowsAsync<McpException>(
            () => CreateTools(dbContext).DeleteTagAsync(tagId, replaceWithTagId: tagId));

        Assert.Equal("Pick another of your tags to replace it with.", error.Message);
    }

    [Fact]
    public async Task DeleteTag_RefusesAnUnknownTag()
    {
        await using var dbContext = TestDb.Create();

        var error = await Assert.ThrowsAsync<McpException>(() => CreateTools(dbContext).DeleteTagAsync(9999));

        Assert.Equal(ToolErrors.TagNotFound, error.Message);
    }

    private static TagTools CreateTools(FlashCardDbContext dbContext)
    {
        return new TagTools(new TagService(dbContext, NullLogger<TagService>.Instance));
    }
}
