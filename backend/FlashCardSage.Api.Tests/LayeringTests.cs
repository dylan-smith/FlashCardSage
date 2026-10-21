using System.Reflection;
using FlashCardSage.Api.Controllers;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Mcp;

namespace FlashCardSage.Api.Tests;

// Controllers and MCP tools reach the database only through the services, so none of them may take or keep a
// FlashCardDbContext.
public class LayeringTests
{
    private static readonly string[] Namespaces = ["FlashCardSage.Api.Controllers", "FlashCardSage.Api.Mcp"];

    private const BindingFlags AllMembers =
        BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;

    // Nested types count too, so a local in an async method (a field of its state machine) or a lambda's capture is
    // caught as well.
    private static readonly Type[] ScannedTypes =
    [
        .. typeof(Program).Assembly.GetTypes().Where(type => Namespaces.Contains(type.Namespace))
    ];

    [Fact]
    public void Scan_FindsTheControllersAndTools()
    {
        Assert.Contains(typeof(CountsController), ScannedTypes);
        Assert.Contains(typeof(CardTools), ScannedTypes);
    }

    [Fact]
    public void ControllersAndTools_DontUseTheDbContext()
    {
        var offenders = ScannedTypes.SelectMany(DbContextUses).ToList();

        Assert.True(
            offenders.Count == 0,
            "These use FlashCardDbContext directly; move the data access into a service:\n"
                + string.Join("\n", offenders));
    }

    private static IEnumerable<string> DbContextUses(Type type)
    {
        foreach (var constructor in type.GetConstructors(AllMembers))
        {
            foreach (var parameter in constructor.GetParameters().Where(p => IsDbContext(p.ParameterType)))
            {
                yield return $"{type.FullName}: constructor parameter '{parameter.Name}'";
            }
        }

        foreach (var method in type.GetMethods(AllMembers))
        {
            foreach (var parameter in method.GetParameters().Where(p => IsDbContext(p.ParameterType)))
            {
                yield return $"{type.FullName}.{method.Name}: parameter '{parameter.Name}'";
            }
        }

        foreach (var field in type.GetFields(AllMembers).Where(f => IsDbContext(f.FieldType)))
        {
            yield return $"{type.FullName}: field '{field.Name}'";
        }

        foreach (var property in type.GetProperties(AllMembers).Where(p => IsDbContext(p.PropertyType)))
        {
            yield return $"{type.FullName}: property '{property.Name}'";
        }
    }

    private static bool IsDbContext(Type type)
    {
        return type.IsAssignableTo(typeof(FlashCardDbContext));
    }
}
