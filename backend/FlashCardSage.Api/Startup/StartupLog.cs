namespace FlashCardSage.Api.Startup;

// What the API reports while it starts, before logging is set up. It goes to the console with a "[Startup]" prefix,
// which the health workbook (infra/workbooks/health.workbook.json) looks for in AppServiceConsoleLogs, so keep both.
public static class StartupLog
{
    public static void Info(string message)
    {
        Console.WriteLine($"[Startup] {message}");
    }
}
