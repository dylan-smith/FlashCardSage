using System.Data.Common;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.SystemDecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace FlashCardSage.Api.Startup;

public static class DatabaseSetup
{
    // An in-memory database when UseInMemoryDatabase is set (local development), otherwise SQL Server.
    public static IServiceCollection AddFlashCardDatabase(this IServiceCollection services, IConfiguration configuration)
    {
        if (UseInMemoryDatabase(configuration))
        {
            StartupLog.Info("Database mode: in-memory.");
            services.AddDbContext<FlashCardDbContext>(options =>
                options.UseInMemoryDatabase("FlashCardSage"));
        }
        else
        {
            StartupLog.Info("Database mode: SQL Server.");
            var connectionString = configuration.GetConnectionString("FlashCardSage")
                ?? throw new InvalidOperationException("Connection string 'FlashCardSage' not found.");

            // Resuming a serverless database from auto-pause can take longer than the 30-second connection
            // timeout, which surfaces as client timeout error -2. EF Core doesn't treat -2 as transient, so
            // add it: the next attempt connects once the resume finishes.
            services.AddDbContext<FlashCardDbContext>(options =>
                options.UseSqlServer(connectionString, sqlOptions => sqlOptions
                    .EnableRetryOnFailure(
                        maxRetryCount: 8,
                        maxRetryDelay: TimeSpan.FromSeconds(10),
                        errorNumbersToAdd: [-2])));
        }

        return services;
    }

    // Creates the in-memory database, or checks the SQL Server one can be reached. The scope, and its context, only
    // last as long as the check.
    public static async Task CheckDatabaseAsync(this WebApplication app)
    {
        using var scope = app.Services.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<FlashCardDbContext>();

        if (UseInMemoryDatabase(app.Configuration))
        {
            dbContext.Database.EnsureCreated();
            StartupLog.Info("In-memory database created.");
            return;
        }

        StartupLog.Info("Testing database connectivity...");

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

            StartupLog.Info("Database connectivity confirmed.");
        }
        catch (Exception ex) when (ex is DbException or RetryLimitExceededException or OperationCanceledException)
        {
            // Don't fail startup: a crashed in-process app keeps serving HTTP 500.30 until it is
            // restarted, even after the database comes back. Start anyway and let each request retry
            // through EF Core's retry-on-failure; the deployment smoke tests catch lasting failures.
            StartupLog.Info(
                $"WARNING: Could not confirm database connectivity; starting anyway. {ex.GetType().Name}: {ex.Message}");
        }
    }

    // The built-in decks users can import. A context of its own, since the seeder makes the system user its current user.
    public static async Task SeedSystemDecksAsync(this WebApplication app)
    {
        using var seedScope = app.Services.CreateScope();
        using var seedTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(60));

        try
        {
            var added = await SystemDeckSeeder.SeedAsync(
                seedScope.ServiceProvider.GetRequiredService<FlashCardDbContext>(),
                seedScope.ServiceProvider.GetRequiredService<CurrentUser>(),
                SystemDeckDefinitions.Load(),
                seedTimeout.Token);
            StartupLog.Info($"System decks: {added} added.");
        }
        catch (Exception ex) when (ex is DbException or DbUpdateException or RetryLimitExceededException or OperationCanceledException)
        {
            // Like the connectivity check, don't fail startup. Another instance starting at the same time may have added
            // the same decks, which fails the unique indexes, and the next start adds any that are still missing.
            StartupLog.Info(
                $"WARNING: Could not add the system decks; starting anyway. {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static bool UseInMemoryDatabase(IConfiguration configuration)
    {
        return configuration.GetValue<bool>("UseInMemoryDatabase");
    }
}
