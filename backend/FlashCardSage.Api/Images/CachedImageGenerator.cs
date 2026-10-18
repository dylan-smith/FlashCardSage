using System.Security.Cryptography;
using System.Text;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Images;

// Keeps every picture the image generator makes, so the same words are only paid for when there's no picture of them
// the user hasn't seen yet. Each request names the last picture the user saw (afterId), and gets the next one made
// for the same prompt, oldest first, which every user shares. Only when there's none left is a new one made, and
// then it's kept too.
//
// The words are user-provided, so like the controller, this never logs them (log-forging).
public class CachedImageGenerator(
    IImageGenerator imageGenerator,
    IImageStore imageStore,
    FlashCardDbContext dbContext,
    ILogger<CachedImageGenerator> logger)
{
    // Whether a picture can be made when there's none left to show.
    public bool IsAvailable => imageGenerator.IsAvailable;

    // The first picture kept for the words after the one with this ID (or the first of all, without one), or null
    // when the user has seen them all. A picture whose file is gone is passed over.
    public async Task<CachedGeneratedImage?> FindAsync(
        string spanish, string english, int? afterId, CancellationToken cancellationToken)
    {
        var hash = PromptHash(spanish, english);
        var after = afterId ?? 0;
        while (await dbContext.GeneratedImages
            .AsNoTracking()
            .Where(item => item.PromptHash == hash && item.Id > after)
            .OrderBy(item => item.Id)
            .FirstOrDefaultAsync(cancellationToken) is { } cached)
        {
            if (await imageStore.LoadAsync(cached.ImageUrl, cancellationToken) is { } data)
            {
                logger.LogInformation("Found picture {GeneratedImageId} in the cache", cached.Id);
                return new CachedGeneratedImage(cached.Id, new GeneratedImage(CardImage.ContentTypeOf(cached.ImageUrl), data));
            }

            logger.LogWarning("The file of cached picture {GeneratedImageId} is gone", cached.Id);
            after = cached.Id;
        }

        return null;
    }

    // Makes a new picture of the words and keeps it. Throws as IImageGenerator.GenerateAsync does.
    public async Task<CachedGeneratedImage> GenerateAsync(
        string spanish, string english, CancellationToken cancellationToken)
    {
        var image = await imageGenerator.GenerateAsync(spanish, english, cancellationToken);

        // The picture has been paid for, so it's kept even if the user has stopped waiting for it.
        var url = await imageStore.SaveAsync(
            CardImage.ContentName(image.Data.Span, image.ContentType), image.Data, CancellationToken.None);
        var cached = new CachedImage
        {
            PromptHash = PromptHash(spanish, english),
            ImageUrl = url,
            CreatedAt = DateTimeOffset.UtcNow
        };
        dbContext.GeneratedImages.Add(cached);
        await dbContext.SaveChangesAsync(CancellationToken.None);
        logger.LogInformation("Kept a new {Length} byte picture as {GeneratedImageId}", image.Data.Length, cached.Id);

        return new CachedGeneratedImage(cached.Id, image);
    }

    // What the pictures are kept by: the prompt they're made from, so words that make the same prompt (the same
    // English, whatever the Spanish) share pictures, and so does their case.
    public static string PromptHash(string spanish, string english)
    {
        var prompt = FoundryImageGenerator.Prompt(spanish, english).ToLowerInvariant();
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(prompt)));
    }
}

// A picture with the ID it's kept under, which the user's next request names to get the one after it.
public record CachedGeneratedImage(int Id, GeneratedImage Image);
