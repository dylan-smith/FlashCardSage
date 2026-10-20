using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Mcp;
using ModelContextProtocol.AspNetCore;
using ModelContextProtocol.Protocol;

namespace FlashCardSage.Api.Startup;

/// <summary>
/// The MCP server at /mcp, which lets an AI assistant the user connects (such as Claude or ChatGPT) work with their
/// flash cards through the tools in Mcp/. It signs in with the OAuth server's access tokens (see AuthenticationSetup).
/// </summary>
public static class McpSetup
{
    public const string Path = "/mcp";

    // Stateless, so any instance can answer any request and nothing is kept between them. Each tool call is made in its
    // request's services, so CurrentUser and the database's query filters work as they do for the controllers.
    // The tools are added type by type: the overloads that find them by scanning the assembly aren't trim-safe, and
    // their warnings fail the build.
    public static IServiceCollection AddFlashCardSageMcp(this IServiceCollection services)
    {
        services.AddMcpServer(options =>
            {
                options.ServerInfo = new Implementation { Name = "FlashCardSage", Version = "1.0" };
                options.ServerInstructions = McpInstructions.Text;
            })
            .WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools<CardTools>()
            .WithTools<TagTools>()
            .WithTools<DeckTools>()
            .WithTools<StatsTools>()
            .WithTools<PictureTools>();

        return services;
    }

    // Left out of the OpenAPI document, which describes the REST API the frontend uses. Any site may call it, for MCP
    // clients that run in a browser.
    public static IEndpointConventionBuilder MapFlashCardSageMcp(this IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapMcp(Path)
            .RequireAuthorization(AuthenticationSetup.McpPolicy)
            .RequireCors(CorsSetup.McpPolicy)
            .ExcludeFromDescription();
    }
}
