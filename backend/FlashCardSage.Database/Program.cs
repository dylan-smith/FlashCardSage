using FlashCardSage.Database;

if (args.Length == 0)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine("Usage: FlashCardSage.Database <connection-string>");
    Console.ResetColor();
    return -1;
}

try
{
    DbUpRunner.Run(args[0]);
    return 0;
}
catch (Exception ex)
{
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine(ex);
    Console.ResetColor();
    return -1;
}
