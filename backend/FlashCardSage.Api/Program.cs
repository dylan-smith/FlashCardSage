using System.Data.Common;
using Azure.Monitor.OpenTelemetry.AspNetCore;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Images;
using FlashCardSage.Api.Suggestions;
using FlashCardSage.Api.Translation;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.FileProviders;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

Console.WriteLine("[Startup] Application starting...");
Console.WriteLine($"[Startup] Environment: {builder.Environment.EnvironmentName}");

var useInMemoryDatabase = builder.Configuration.GetValue<bool>("UseInMemoryDatabase");

var aiConnectionStringFromConfig = builder.Configuration["AzureMonitor:ConnectionString"]
    is string cs && !string.IsNullOrWhiteSpace(cs)
    ? cs
    : null;
var aiConnectionStringFromEnv = builder.Configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"]
    is string envCs && !string.IsNullOrWhiteSpace(envCs)
    ? envCs
    : null;
var azureMonitorConnectionString = aiConnectionStringFromConfig ?? aiConnectionStringFromEnv;

if (aiConnectionStringFromConfig != null)
{
    Console.WriteLine("[Startup] Application Insights connection string found in AzureMonitor:ConnectionString config setting.");
}
else if (aiConnectionStringFromEnv != null)
{
    Console.WriteLine("[Startup] Application Insights connection string found in APPLICATIONINSIGHTS_CONNECTION_STRING environment variable.");
}
else
{
    Console.WriteLine("[Startup] No Application Insights connection string found. Telemetry will be disabled.");
}

if (!string.IsNullOrWhiteSpace(azureMonitorConnectionString))
{
    Console.WriteLine("[Startup] Configuring Azure Monitor / Application Insights...");
    builder.Services.AddOpenTelemetry().UseAzureMonitor(options =>
        options.ConnectionString = azureMonitorConnectionString);
    Console.WriteLine("[Startup] Azure Monitor / Application Insights configured successfully.");
}

builder.Services.AddFlashCardSageAuthentication(builder.Configuration);
builder.Services.AddControllers();
// No database check: the availability test pings /health, and touching SQL would stop the serverless database
// from auto-pausing.
builder.Services.AddHealthChecks();
builder.Services.AddOpenApi();
builder.Services.Configure<TranslatorOptions>(builder.Configuration.GetSection(TranslatorOptions.SectionName));
// Translation fills in a field while the user types, so a slow answer is no better than none.
builder.Services.AddHttpClient<ITranslator, AzureTranslator>(client => client.Timeout = TimeSpan.FromSeconds(10));
builder.Services.Configure<CardSuggesterOptions>(builder.Configuration.GetSection(CardSuggesterOptions.SectionName));
// The Anthropic SDK times out and retries requests itself.
builder.Services.AddHttpClient<ICardSuggester, ClaudeCardSuggester>(client => client.Timeout = Timeout.InfiniteTimeSpan);
builder.Services.Configure<ImageGenerationOptions>(builder.Configuration.GetSection(ImageGenerationOptions.SectionName));
// A picture takes the model tens of seconds, and the user asked for it, so they're given that long.
builder.Services.AddHttpClient<IImageGenerator, FoundryImageGenerator>(client =>
    client.Timeout = TimeSpan.FromSeconds(60));
builder.Services.Configure<ImageStoreOptions>(builder.Configuration.GetSection(ImageStoreOptions.SectionName));
// Pictures go to Azure Blob Storage when there's a connection string, otherwise (local development, E2E tests) to
// files the API serves itself.
var useLocalImageStore = string.IsNullOrWhiteSpace(builder.Configuration["ImageStore:StorageConnectionString"]);
if (useLocalImageStore)
{
    Console.WriteLine("[Startup] Image store: local files.");
    builder.Services.AddHttpContextAccessor();
    builder.Services.AddSingleton<LocalFileImageStore>();
    builder.Services.AddSingleton<IImageStore>(services => services.GetRequiredService<LocalFileImageStore>());
}
else
{
    Console.WriteLine("[Startup] Image store: Azure Blob Storage.");
    builder.Services.AddSingleton<IImageStore, BlobImageStore>();
}

var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? [];

Console.WriteLine(
    allowedOrigins.Length == 0
        ? "[Startup] CORS: No allowed origins configured."
        : $"[Startup] CORS allowed origins: {string.Join(", ", allowedOrigins)}");

builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length == 0)
        {
            return;
        }

        // The frontend's telemetry adds a traceparent header, which makes every request preflighted, so let
        // browsers cache the preflight response.
        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .SetPreflightMaxAge(TimeSpan.FromMinutes(10));
    }));

if (useInMemoryDatabase)
{
    Console.WriteLine("[Startup] Database mode: in-memory.");
    builder.Services.AddDbContext<FlashCardDbContext>(options =>
        options.UseInMemoryDatabase("FlashCardSage"));
}
else
{
    Console.WriteLine("[Startup] Database mode: SQL Server.");
    var connectionString = builder.Configuration.GetConnectionString("FlashCardSage")
        ?? throw new InvalidOperationException("Connection string 'FlashCardSage' not found.");

    // Resuming a serverless database from auto-pause can take longer than the 30-second connection
    // timeout, which surfaces as client timeout error -2. EF Core doesn't treat -2 as transient, so
    // add it: the next attempt connects once the resume finishes.
    builder.Services.AddDbContext<FlashCardDbContext>(options =>
        options.UseSqlServer(connectionString, sqlOptions => sqlOptions
            .EnableRetryOnFailure(
                maxRetryCount: 8,
                maxRetryDelay: TimeSpan.FromSeconds(10),
                errorNumbersToAdd: [-2])));
}

var app = builder.Build();

app.MapOpenApi().AllowAnonymous();
app.MapScalarApiReference().AllowAnonymous();

using var scope = app.Services.CreateScope();
var dbContext = scope.ServiceProvider.GetRequiredService<FlashCardDbContext>();

if (useInMemoryDatabase)
{
    dbContext.Database.EnsureCreated();
    Console.WriteLine("[Startup] In-memory database created.");
}
else
{
    Console.WriteLine("[Startup] Testing database connectivity...");

    // Open the connection through the SQL Server execution strategy so that transient errors,
    // such as 40613 while a serverless Azure SQL database resumes from auto-pause, are retried.
    // Individual attempts can each run up to the connection timeout, so a hard deadline keeps the
    // whole check under the ASP.NET Core Module's default 120-second startup time limit.
    using var connectTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));

    try
    {
        await dbContext.Database.CreateExecutionStrategy().ExecuteAsync(async cancellationToken =>
        {
            await dbContext.Database.OpenConnectionAsync(cancellationToken);
            await dbContext.Database.CloseConnectionAsync();
        }, connectTimeout.Token);

        Console.WriteLine("[Startup] Database connectivity confirmed.");
    }
    catch (Exception ex) when (ex is DbException or RetryLimitExceededException or OperationCanceledException)
    {
        // Don't fail startup: a crashed in-process app keeps serving HTTP 500.30 until it is
        // restarted, even after the database comes back. Start anyway and let each request retry
        // through EF Core's retry-on-failure; the deployment smoke tests catch lasting failures.
        Console.WriteLine(
            $"[Startup] WARNING: Could not confirm database connectivity; starting anyway. {ex.GetType().Name}: {ex.Message}");
    }
}

app.UseCors();
if (useLocalImageStore)
{
    // Before authentication, so a browser can load a picture by its URL like it does from blob storage: every
    // endpoint needs a signed-in user otherwise (see AuthenticationSetup).
    var localImageStore = app.Services.GetRequiredService<LocalFileImageStore>();
    Directory.CreateDirectory(localImageStore.Directory);
    Console.WriteLine($"[Startup] Serving pictures from {localImageStore.Directory} on {ImageStoreOptions.LocalRequestPath}.");
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(localImageStore.Directory),
        RequestPath = ImageStoreOptions.LocalRequestPath
    });
}

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseMiddleware<CurrentUserMiddleware>();
app.UseAuthorization();
app.MapControllers();
app.MapHealthChecks("/health").AllowAnonymous();

Console.WriteLine("[Startup] Application startup complete. Listening for requests...");

app.Run();
