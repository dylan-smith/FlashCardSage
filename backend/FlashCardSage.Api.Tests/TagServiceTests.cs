using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

// The reads, which TagsControllerTests covers as responses along with the changes.
public class TagServiceTests
{
    [Fact]
    public async Task GetAllAsync_ReturnsTheUsersTagsByName_WithoutAnotherUsers()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Verbs");
        await TestDb.SeedTagAsync(databaseName, TestDb.UserId, "Animals");
        await TestDb.SeedAsOtherUserAsync(databaseName, other => other.Tags.Add(new Tag { Name = "Food" }));
        await using var dbContext = TestDb.Create(databaseName);

        var tags = await new TagService(dbContext, NullLogger<TagService>.Instance).GetAllAsync();

        Assert.Equal(["Animals", "Verbs"], tags.Select(tag => tag.Name));
    }
}
