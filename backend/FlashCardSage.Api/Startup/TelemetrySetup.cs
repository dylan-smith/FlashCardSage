using Azure.Monitor.OpenTelemetry.AspNetCore;

namespace FlashCardSage.Api.Startup;

public static class TelemetrySetup
{
    // Sends telemetry to Application Insights when there's a connection string, from the AzureMonitor:ConnectionString
    // setting or else the APPLICATIONINSIGHTS_CONNECTION_STRING environment variable.
    public static IServiceCollection AddFlashCardSageTelemetry(this IServiceCollection services, IConfiguration configuration)
    {
        var aiConnectionStringFromConfig = configuration["AzureMonitor:ConnectionString"]
            is string cs && !string.IsNullOrWhiteSpace(cs)
            ? cs
            : null;
        var aiConnectionStringFromEnv = configuration["APPLICATIONINSIGHTS_CONNECTION_STRING"]
            is string envCs && !string.IsNullOrWhiteSpace(envCs)
            ? envCs
            : null;
        var azureMonitorConnectionString = aiConnectionStringFromConfig ?? aiConnectionStringFromEnv;

        if (aiConnectionStringFromConfig != null)
        {
            StartupLog.Info("Application Insights connection string found in AzureMonitor:ConnectionString config setting.");
        }
        else if (aiConnectionStringFromEnv != null)
        {
            StartupLog.Info("Application Insights connection string found in APPLICATIONINSIGHTS_CONNECTION_STRING environment variable.");
        }
        else
        {
            StartupLog.Info("No Application Insights connection string found. Telemetry will be disabled.");
        }

        if (!string.IsNullOrWhiteSpace(azureMonitorConnectionString))
        {
            StartupLog.Info("Configuring Azure Monitor / Application Insights...");
            services.AddOpenTelemetry().UseAzureMonitor(options =>
                options.ConnectionString = azureMonitorConnectionString);
            StartupLog.Info("Azure Monitor / Application Insights configured successfully.");
        }

        return services;
    }
}
