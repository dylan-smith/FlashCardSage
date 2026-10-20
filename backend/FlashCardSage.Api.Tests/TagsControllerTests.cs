using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;

namespace FlashCardSage.Api.Tests;

public class TagsControllerTests
{
    [Fact]
    public async Task GetAll_ReturnsTheUsersTagsInNameOrder()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Tags.Add(new Tag { Name = "Theirs" }));

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

        ActionResultAssert.ValidationProblem(result.Result, "Name", "Tag name is required.");
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

        ActionResultAssert.ValidationProblem(result.Result, "Name", "There's already a tag with that name.");
        Assert.Single(await dbContext.Tags.ToListAsync());
    }

    [Fact]
    public async Task Create_AllowsANameAnotherUserHas()
    {
        var databaseName = TestDb.NewDatabaseName();
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Tags.Add(new Tag { Name = "Food" }));

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

        Assert.Equal("Food", ActionResultAssert.Ok<Tag>(result.Result).Name);
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

        ActionResultAssert.ValidationProblem(result.Result, "Name", "Tag name is required.");
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

        ActionResultAssert.ValidationProblem(result.Result, "Name", "There's already a tag with that name.");
    }

    [Fact]
    public async Task Delete_RemovesTheTagFromItsCards_AndKeepsTheCards()
    {
        var databaseName = TestDb.NewDatabaseName();
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
    public async Task Delete_PutsTheReplacementOnItsCards()
    {
        var databaseName = TestDb.NewDatabaseName();
        int tagId;
        int replacementId;
        await using (var setupContext = TestDb.Create(databaseName))
        {
            var tag = new Tag { Name = "Animal" };
            var replacement = new Tag { Name = "Animals" };
            setupContext.FlashCards.AddRange(
                new FlashCard { Words = TestDb.Words("el gato", "the cat"), Tags = [tag, replacement] },
                new FlashCard { Words = TestDb.Words("el león", "the lion"), Tags = [tag] },
                TestDb.Card("el pan", "the bread", ["Food"]));
            await setupContext.SaveChangesAsync();
            tagId = tag.Id;
            replacementId = replacement.Id;
        }

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NoContentResult>(await controller.Delete(tagId, replacementId));

        await using var checkContext = TestDb.Create(databaseName);
        var cards = await checkContext.FlashCards.Include(card => card.Tags).OrderBy(card => card.Id).ToListAsync();
        Assert.Equal([["Animals"], ["Animals"], ["Food"]], cards.Select(card => card.Tags.Select(tag => tag.Name).ToList()));
        Assert.Equal(["Animals", "Food"], await checkContext.Tags.OrderBy(tag => tag.Name).Select(tag => tag.Name).ToListAsync());
    }

    [Fact]
    public async Task Delete_ReturnsValidationProblem_WhenTheReplacementIsTheTagItself()
    {
        await using var dbContext = TestDb.Create();
        var tag = new Tag { Name = "Food" };
        dbContext.Tags.Add(tag);
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Delete(tag.Id, tag.Id);

        ActionResultAssert.ValidationProblem(result, "replaceWith", "Pick another of your tags to replace it with.");
        Assert.Single(await dbContext.Tags.ToListAsync());
    }

    [Fact]
    public async Task Delete_ReturnsValidationProblem_WhenTheReplacementIsAnotherUsersTag()
    {
        var databaseName = TestDb.NewDatabaseName();
        var other = new Tag { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Tags.Add(other));

        await using var dbContext = TestDb.Create(databaseName);
        var tag = new Tag { Name = "Food" };
        dbContext.FlashCards.Add(new FlashCard { Words = TestDb.Words("el pan", "the bread"), Tags = [tag] });
        await dbContext.SaveChangesAsync();
        var controller = CreateController(dbContext);

        var result = await controller.Delete(tag.Id, other.Id);

        Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result).Value);
        Assert.Equal(2, await dbContext.Tags.IgnoreQueryFilters().CountAsync());
        await using var checkContext = TestDb.Create(databaseName);
        Assert.Equal("Food", (await checkContext.FlashCards.Include(card => card.Tags).SingleAsync()).Tags.Single().Name);
    }

    [Fact]
    public async Task OtherUsersTags_CannotBeRenamedOrDeleted()
    {
        var databaseName = TestDb.NewDatabaseName();
        var other = new Tag { Name = "Theirs" };
        await TestDb.SeedAsOtherUserAsync(databaseName, otherContext => otherContext.Tags.Add(other));

        await using var dbContext = TestDb.Create(databaseName);
        var controller = CreateController(dbContext);

        Assert.IsType<NotFoundResult>((await controller.Update(other.Id, new TagRequest { Name = "Mine" })).Result);
        Assert.IsType<NotFoundResult>(await controller.Delete(other.Id));
        Assert.Equal("Theirs", (await dbContext.Tags.IgnoreQueryFilters().SingleAsync()).Name);
    }

    private static TagsController CreateController(FlashCardDbContext dbContext)
    {
        return new TagsController(
            dbContext,
            new TagService(dbContext, NullLogger<TagService>.Instance),
            NullLogger<TagsController>.Instance);
    }
}
