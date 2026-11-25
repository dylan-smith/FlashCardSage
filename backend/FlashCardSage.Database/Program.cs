using FlashCardSage.Database;

if (args.Length == 0)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine("Usage: FlashCardSage.Database <connection-string>");
    Console.WriteLine("       FlashCardSage.Database --check-connection <connection-string>");
    Console.WriteLine("       FlashCardSage.Database --run-script <file> <connection-string> [<name>=<value> ...]");
    Console.ResetColor();
    return -1;
}

try
{
    switch (args)
    {
        // Only reports whether this machine can connect, without running the migrations.
        case ["--check-connection", var connectionString]:
            return ConnectionCheck.Run(connectionString);

        // Runs one script that isn't a migration, such as the one that creates a preview's database user.
        case ["--run-script", var path, var connectionString, .. var variables]:
            ScriptRunner.Run(path, connectionString, variables);
            return 0;

        default:
            DbUpRunner.Run(args[0]);
            return 0;
    }
}
catch (Exception ex)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine(ex);
    Console.ResetColor();
    return -1;
}
