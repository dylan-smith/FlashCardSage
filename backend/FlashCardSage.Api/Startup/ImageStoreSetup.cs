using FlashCardSage.Api.Images;
using Microsoft.Extensions.FileProviders;

namespace FlashCardSage.Api.Startup;

public static class ImageStoreSetup
{
    // Pictures go to Azure Blob Storage when there's a connection string, otherwise (local development, E2E tests) to
    // files the API serves itself.
    public static IServiceCollection AddImageStore(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<ImageStoreOptions>().BindConfiguration(ImageStoreOptions.SectionName);

        var options = configuration.GetSection(ImageStoreOptions.SectionName).Get<ImageStoreOptions>()
            ?? new ImageStoreOptions();
        if (string.IsNullOrWhiteSpace(options.StorageConnectionString))
        {
            StartupLog.Info("Image store: local files.");
            services.AddHttpContextAccessor();
            services.AddSingleton<LocalFileImageStore>();
            services.AddSingleton<IImageStore>(provider => provider.GetRequiredService<LocalFileImageStore>());
        }
        else
        {
            StartupLog.Info("Image store: Azure Blob Storage.");
            services.AddSingleton<IImageStore, BlobImageStore>();
        }

        return services;
    }

    // Serves the local files when AddImageStore chose them. Before authentication, so a browser can load a picture by
    // its URL like it does from blob storage: every endpoint needs a signed-in user otherwise (see AuthenticationSetup).
    public static WebApplication UseLocalImageFiles(this WebApplication app)
    {
        if (app.Services.GetService<LocalFileImageStore>() is not { } localImageStore)
        {
            return app;
        }

        Directory.CreateDirectory(localImageStore.Directory);
        StartupLog.Info($"Serving pictures from {localImageStore.Directory} on {ImageStoreOptions.LocalRequestPath}.");
        app.UseStaticFiles(new StaticFileOptions
        {
            FileProvider = new PhysicalFileProvider(localImageStore.Directory),
            RequestPath = ImageStoreOptions.LocalRequestPath
        });

        return app;
    }
}
