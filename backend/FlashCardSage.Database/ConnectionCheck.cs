using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace FlashCardSage.Database;

/// <summary>
/// Tells a deployment whether this machine can connect to the database, so it can let itself through the SQL
/// server's firewall when it can't (see .github/scripts/sql-firewall.sh).
/// </summary>
public static partial class ConnectionCheck
{
    public const int Connected = 0;

    /// <summary>
    /// The server's firewall turned this machine away. The server's name and this machine's address, as the server
    /// saw it, are written to standard output with a space between them.
    /// </summary>
    public const int TurnedAway = 3;

    // Azure SQL's error for a client whose address no firewall rule allows.
    private const int AddressNotAllowed = 40615;

    /// <summary>
    /// Opens a connection and returns <see cref="Connected"/> or <see cref="TurnedAway"/>. Anything else that stops
    /// it is thrown.
    /// </summary>
    public static int Run(string connectionString)
    {
        try
        {
            using var connection = new SqlConnection(connectionString);
            connection.Open();

            return Connected;
        }
        catch (SqlException ex) when (FindRejection(ex) is { Success: true } rejection)
        {
            Console.WriteLine($"{rejection.Groups["server"].Value} {rejection.Groups["address"].Value}");

            return TurnedAway;
        }
    }

    // The firewall's error names the server and the address: "Cannot open server 'name' requested by the login.
    // Client with IP address '1.2.3.4' is not allowed to access the server."
    private static Match? FindRejection(SqlException exception)
    {
        return exception.Errors
            .Cast<SqlError>()
            .Where(error => error.Number == AddressNotAllowed)
            .Select(error => Rejection().Match(error.Message))
            .FirstOrDefault();
    }

    [GeneratedRegex(@"server '(?<server>[^']+)'.*IP address '(?<address>[0-9.]+)'", RegexOptions.CultureInvariant | RegexOptions.Singleline)]
    private static partial Regex Rejection();
}
