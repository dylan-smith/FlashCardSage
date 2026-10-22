using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Speech;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Suggestions.Foundry;
using FlashCardSage.Api.Translation;
using Microsoft.Extensions.Options;

namespace FlashCardSage.Api.Startup;

public static class AiServicesSetup
{
    // Translation, card and tag suggestions, document scans, pictures and spoken audio, each a typed HttpClient with a
    // timeout that suits how long the user waits for it.
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
        // The page asks for suggestions every time it's opened, so they're kept until the user's cards change.
        services.AddScoped<CachedCardSuggester>();
        // Tag suggestions come while the user is filling in a card, so like translation, a slow answer is no better than none.
        services.AddHttpClient<ITagSuggester, FoundryTagSuggester>(client => client.Timeout = TimeSpan.FromSeconds(20));
        // The Tags page asks for new tags every time it's opened, so they're kept until the user's tags and cards change.
        services.AddScoped<CachedTagSuggester>();
        // Scanning a document makes up to a hundred cards, which takes the model a while, and the user asked for it and waits.
        services.AddHttpClient<IDocumentScanner, FoundryDocumentScanner>(client =>
            client.Timeout = TimeSpan.FromSeconds(150));
        services.AddOptions<ImageGenerationOptions>().BindConfiguration(ImageGenerationOptions.SectionName);
        // A picture takes the model tens of seconds, and the user asked for it, so they're given that long.
        services.AddHttpClient<FoundryImageGenerator>(client => client.Timeout = TimeSpan.FromSeconds(60));
        // The E2E tests have no Foundry, so they ask for a sample picture instead.
        services.AddScoped<IImageGenerator>(provider =>
            provider.GetRequiredService<IOptions<ImageGenerationOptions>>().Value.UseSamplePicture
                ? new SampleImageGenerator()
                : provider.GetRequiredService<FoundryImageGenerator>());
        // Every picture is kept, so the same words are only paid for once the user has seen every picture of them.
        services.AddScoped<CachedImageGenerator>();
        services.AddOptions<SpeechOptions>().BindConfiguration(SpeechOptions.SectionName);
        // A phrase is read in well under a second, and the user is waiting with a finger on the button.
        services.AddHttpClient<AzureSpeechSynthesizer>(client => client.Timeout = TimeSpan.FromSeconds(15));
        // The E2E tests have no Foundry, so they ask for a sample silence instead.
        services.AddScoped<ISpeechSynthesizer>(provider =>
            provider.GetRequiredService<IOptions<SpeechOptions>>().Value.UseSampleAudio
                ? new SampleSpeechSynthesizer()
                : provider.GetRequiredService<AzureSpeechSynthesizer>());
        // Every phrase's audio is kept, so a phrase is only paid for the first time anyone asks to hear it.
        services.AddScoped<CachedSpeechSynthesizer>();

        return services;
    }
}
