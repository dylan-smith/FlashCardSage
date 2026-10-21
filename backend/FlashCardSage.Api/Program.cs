using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Services;
using FlashCardSage.Api.Startup;
using FlashCardSage.Api.SystemDecks;
using FlashCardSage.Api.Usage;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

StartupLog.Info("Application starting...");
StartupLog.Info($"Environment: {builder.Environment.EnvironmentName}");

builder.Services.AddFlashCardSageTelemetry(builder.Configuration);
builder.Services.AddFlashCardSageAuthentication(builder.Configuration);
builder.Services.AddControllers();
// The card, tag, deck, picture, practice, counts, preferences and built-in deck logic the controllers use.
builder.Services.AddScoped<FlashCardService>();
builder.Services.AddScoped<TagService>();
builder.Services.AddScoped<DeckService>();
builder.Services.AddScoped<CardPictureService>();
builder.Services.AddScoped<PracticeService>();
builder.Services.AddScoped<CountsService>();
builder.Services.AddScoped<PreferencesService>();
builder.Services.AddScoped<SystemDeckImporter>();
// The MCP server AI assistants connect to, which uses the services above.
builder.Services.AddFlashCardSageMcp();
// No database check: the availability test pings /health, and touching SQL would stop the serverless database
// from auto-pausing.
builder.Services.AddHealthChecks();
builder.Services.AddOpenApi();
// Signed-in requests ask for a usage snapshot now and then (see CurrentUserMiddleware).
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<UsageSnapshotService>();
builder.Services.AddHostedService(services => services.GetRequiredService<UsageSnapshotService>());
builder.Services.AddAiUsageTracking(builder.Configuration);
builder.Services.AddAiServices();
builder.Services.AddImageStore(builder.Configuration);

// Puts the built-in cards' pictures on them once the API has started.
builder.Services.AddHostedService<SystemDeckImageSyncService>();

builder.Services.AddFlashCardSageCors(builder.Configuration);
builder.Services.AddFlashCardDatabase(builder.Configuration);

var app = builder.Build();

app.MapOpenApi().AllowAnonymous();
app.MapScalarApiReference().AllowAnonymous();

await app.CheckDatabaseAsync();
await app.SeedSystemDecksAsync();

app.UseCors();
app.UseLocalImageFiles();
app.UseHttpsRedirection();
app.UseAuthentication();
app.UseMiddleware<CurrentUserMiddleware>();
app.UseAuthorization();
app.MapControllers();
app.MapFlashCardSageMcp();
app.MapHealthChecks("/health").AllowAnonymous();

StartupLog.Info("Application startup complete. Listening for requests...");

app.Run();
