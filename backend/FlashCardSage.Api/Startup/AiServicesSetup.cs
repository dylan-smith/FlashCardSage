using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Suggestions.Foundry;
using FlashCardSage.Api.Translation;

namespace FlashCardSage.Api.Startup;

public static class AiServicesSetup
{
    // Translation, card and tag suggestions, document scans and pictures, each a typed HttpClient with a timeout that
    // suits how long the user waits for it.
    public static IServiceCollection AddAiServices(this IServiceCollection services)
    {
        services.AddOptions<TranslatorOptions>().BindConfiguration(TranslatorOptions.SectionName);
        // Translation fills in a field while the user types, so a slow answer is no better than none.
        services.AddHttpClient<AzureTranslator>(client => client.Timeout = TimeSpan.FromSeconds(10));
        // Every translation is kept in the database, so a text is only paid for the first time anyone types it.
        services.AddScoped<ITranslator>(provider => new CachedTranslator(
            provider.GetRequiredService<AzureTranslator>(),
            provider.GetRequiredService<FlashCardDbContext>(),
            provider.GetRequiredService<ILogger<CachedTranslator>>()));
        services.AddOptions<FoundryChatOptions>().BindConfiguration(FoundryChatOptions.SectionName);
        // The page shows suggestions as soon as they come, and they're only a nicety, so a slow answer isn't waited out.
        services.AddHttpClient<ICardSuggester, FoundryCardSuggester>(client => client.Timeout = TimeSpan.FromSeconds(45));
        // Tag suggestions come while the user is filling in a card, so like translation, a slow answer is no better than none.
        services.AddHttpClient<ITagSuggester, FoundryTagSuggester>(client => client.Timeout = TimeSpan.FromSeconds(20));
        // Scanning a document makes up to a hundred cards, which takes the model a while, and the user asked for it and waits.
        services.AddHttpClient<IDocumentScanner, FoundryDocumentScanner>(client =>
            client.Timeout = TimeSpan.FromSeconds(150));
        services.AddOptions<ImageGenerationOptions>().BindConfiguration(ImageGenerationOptions.SectionName);
        // A picture takes the model tens of seconds, and the user asked for it, so they're given that long.
        services.AddHttpClient<IImageGenerator, FoundryImageGenerator>(client =>
            client.Timeout = TimeSpan.FromSeconds(60));
        // Every picture is kept, so the same words are only paid for once the user has seen every picture of them.
        services.AddScoped<CachedImageGenerator>();

        return services;
    }
}
