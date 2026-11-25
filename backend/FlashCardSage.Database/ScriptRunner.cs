using DbUp.Helpers;

namespace FlashCardSage.Database;

/// <summary>
/// Runs one SQL script that isn't a migration: it runs every time it's asked for, and isn't recorded. It connects
/// the same way the migrations do, so it works wherever they do.
/// </summary>
public static class ScriptRunner
{
    /// <param name="variables">
    /// Each as name=value. Every $name$ in the script is replaced by its value.
    /// </param>
    public static void Run(string path, string connectionString, IEnumerable<string> variables)
    {
        var values = variables.Select(ReadVariable).ToDictionary(variable => variable.Name, variable => variable.Value);

        var result = DbUp.DeployChanges.To
            .SqlDatabase(connectionString)
            .WithScript(Path.GetFileName(path), File.ReadAllText(path))
            .WithVariables(values)
            .JournalTo(new NullJournal())
            .LogToConsole()
            .Build()
            .PerformUpgrade();

        if (!result.Successful)
        {
            throw result.Error;
        }
    }

    private static (string Name, string Value) ReadVariable(string variable)
    {
        var separator = variable.IndexOf('=', StringComparison.Ordinal);

        return separator > 0
            ? (variable[..separator], variable[(separator + 1)..])
            : throw new ArgumentException($"Expected a variable as name=value, but got '{variable}'.", nameof(variable));
    }
}
