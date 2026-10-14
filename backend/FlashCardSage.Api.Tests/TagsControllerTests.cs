using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class TagsControllerTests
{
    [Fact]
    public async Task GetAll_ReturnsTheUsersTagsInNameOrder()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Tags.Add(new Tag { Name = "Theirs" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        dbContext.Tags.AddRange(new Tag { Name = "Travel" }, new Tag { Name = "Food" });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.GetAll();

        var tags = Assert.IsAssignableFrom<IEnumerable<Tag>>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(["Food", "Travel"], tags.Select(tag => tag.Name));
    }

    [Fact]
    public async Task Create_TrimsAndAddsTheTag()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new TagRequest { Name = "  Food  " });

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(201, created.StatusCode);
        var tag = Assert.IsType<Tag>(created.Value);
        Assert.Equal("Food", tag.Name);
        Assert.Equal(tag.Id, (await dbContext.Tags.SingleAsync()).Id);
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenTheNameIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new TagRequest { Name = "   " });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Tag name is required."], problem.Errors["Name"]);
        Assert.Empty(await dbContext.Tags.ToListAsync());
    }

    [Fact]
    public async Task Create_ReturnsValidationProblem_WhenTheUserHasTheNameAlready()
    {
        await using var dbContext = TestDb.Create();
        dbContext.Tags.Add(new Tag { Name = "Food" });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Create(new TagRequest { Name = "food" });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["There's already a tag with that name."], problem.Errors["Name"]);
        Assert.Single(await dbContext.Tags.ToListAsync());
    }

    [Fact]
    public async Task Create_AllowsANameAnotherUserHas()
    {
        var databaseName = Guid.NewGuid().ToString();
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            otherContext.Tags.Add(new Tag { Name = "Food" });
            await otherContext.SaveChangesAsync();
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        var result = await controller.Create(new TagRequest { Name = "Food" });

        Assert.Equal(201, Assert.IsType<ObjectResult>(result.Result).StatusCode);
        Assert.Equal(2, await dbContext.Tags.IgnoreQueryFilters().CountAsync());
        Assert.Equal(TestDb.UserId, (await dbContext.Tags.SingleAsync()).UserId);
    }

    [Fact]
    public async Task Update_TrimsAndRenamesTheTag()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Fod" };
        dbContext.Tags.Add(tag);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Update(tag.Id, new TagRequest { Name = "  Food  " });

        Assert.Equal("Food", Assert.IsType<Tag>(Assert.IsType<OkObjectResult>(result.Result).Value).Name);
        Assert.Equal("Food", (await dbContext.Tags.SingleAsync()).Name);
    }

    [Fact]
    public async Task Update_AllowsChangingOnlyTheCase()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "food" };
        dbContext.Tags.Add(tag);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Update(tag.Id, new TagRequest { Name = "Food" });

        Assert.IsType<OkObjectResult>(result.Result);
        Assert.Equal("Food", (await dbContext.Tags.SingleAsync()).Name);
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenTheNameIsBlank()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Food" };
        dbContext.Tags.Add(tag);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Update(tag.Id, new TagRequest { Name = "   " });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["Tag name is required."], problem.Errors["Name"]);
        Assert.Equal("Food", (await dbContext.Tags.SingleAsync()).Name);
    }

    [Fact]
    public async Task Update_ReturnsValidationProblem_WhenAnotherTagHasTheName()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Fruit" };
        dbContext.Tags.AddRange(tag, new Tag { Name = "Food" });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Update(tag.Id, new TagRequest { Name = "food" });

        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result.Result).Value);
        Assert.Equal(["There's already a tag with that name."], problem.Errors["Name"]);
    }

    [Fact]
    public async Task Delete_RemovesTheTagFromItsCards_AndKeepsTheCards()
    {
        var databaseName = Guid.NewGuid().ToString();
        int tagId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var tag = new Tag { Name = "Animals" };
            setupContext.FlashCards.AddRange(
                new FlashCard { Words = TestDb.Words("el gato", "the cat"), Tags = [tag, new Tag { Name = "Pets" }] },
                new FlashCard { Words = TestDb.Words("el león", "the lion"), Tags = [tag] });
            await setupContext.SaveChangesAsync();
            tagId = tag.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NoContentResult>(await controller.Delete(tagId));

        await using var checkContext = TestDb.Create(databaseName);
        var cards = await checkContext.FlashCards.Include(card => card.Tags).OrderBy(card => card.Id).ToListAsync();
        Assert.Equal([["Pets"], []], cards.Select(card => card.Tags.Select(tag => tag.Name).ToList()));
        Assert.Equal("Pets", (await checkContext.Tags.SingleAsync()).Name);
    }

    [Fact]
    public async Task OtherUsersTags_CannotBeRenamedOrDeleted()
    {
        var databaseName = Guid.NewGuid().ToString();
        int otherId;
        await using (var otherContext = TestDb.Create(databaseName, TestDb.OtherUserId))
        {
            var other = new Tag { Name = "Theirs" };
            otherContext.Tags.Add(other);
            await otherContext.SaveChangesAsync();
            otherId = other.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.Update(otherId, new TagRequest { Name = "Mine" })).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(otherId));
        Assert.Equal("Theirs", (await dbContext.Tags.IgnoreQueryFilters().SingleAsync()).Name);
    }

    private static TagsController CreateController(FlashCardDbContext dbContext)
    {
        return new TagsController(dbContext, NullLogger<TagsController>.Instance);
    }
}
