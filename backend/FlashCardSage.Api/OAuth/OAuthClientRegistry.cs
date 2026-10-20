using FlashCardSage.Api.Contracts;
using FlashCardSage.Api.Data;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.OAuth;

// A registered app, or why it wasn't registered.
public record OAuthRegistration(OAuthClient? Client, OAuthError? Error);

/// <summary>
/// The apps that can sign users in. An app either registers itself (RFC 7591 dynamic client registration, as ChatGPT
/// and most MCP clients do) and is given a random client ID, or its client ID is the https URL of a metadata document
/// about it (as Claude does), which is fetched when it's first seen and again once it's an hour old.
/// </summary>
public class OAuthClientRegistry(
    FlashCardDbContext dbContext,
    ClientMetadataFetcher metadataFetcher,
    TimeProvider timeProvider,
    ILogger<OAuthClientRegistry> logger)
{
    public const int MaxRedirectUris = 10;

    public static readonly TimeSpan MetadataDocumentLifetime = TimeSpan.FromHours(1);

    private static readonly string[] GrantTypes = ["authorization_code", "refresh_token"];

    public async Task<OAuthRegistration> RegisterAsync(
        OAuthClientRegistrationRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var redirectUris = request.RedirectUris ?? [];
        if (redirectUris.Count is 0 or > MaxRedirectUris || !redirectUris.All(RedirectUris.IsAcceptable))
        {
            return Refused(
                OAuthErrors.InvalidRedirectUri,
                $"Give 1 to {MaxRedirectUris} redirect URIs, each absolute with no fragment, and https unless it's an "
                + "app's own scheme or http on 127.0.0.1, [::1] or localhost.");
        }

        if (request.TokenEndpointAuthMethod is not (null or "none"))
        {
            return Refused(
                OAuthErrors.InvalidClientMetadata,
                "Only public clients can register: token_endpoint_auth_method must be none.");
        }

        if (request.GrantTypes?.Except(GrantTypes, StringComparer.Ordinal).Any() == true
            || request.ResponseTypes?.Any(type => type != "code") == true)
        {
            return Refused(
                OAuthErrors.InvalidClientMetadata,
                "Only the authorization_code and refresh_token grants, and the code response type, are supported.");
        }

        var name = request.ClientName?.Trim();
        if (name?.Length > OAuthClient.MaxNameLength)
        {
            return Refused(
                OAuthErrors.InvalidClientMetadata,
                $"client_name can be up to {OAuthClient.MaxNameLength} characters.");
        }

        var now = timeProvider.GetUtcNow();
        var client = new OAuthClient
        {
            ClientId = OAuthTokens.NewClientId(),
            Name = string.IsNullOrEmpty(name) ? null : name,
            RedirectUris = [.. redirectUris],
            IsMetadataDocument = false,
            CreatedAt = now,
            UpdatedAt = now
        };
        dbContext.OAuthClients.Add(client);
        await dbContext.SaveChangesAsync(cancellationToken);

        logger.LogInformation("Registered OAuth client {OAuthClientId}", client.Id);

        return new OAuthRegistration(client, null);
    }

    // The app with this client ID, or null when there's none or its metadata document can't be used.
    public async Task<OAuthClient?> ResolveAsync(string? clientId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(clientId) || clientId.Length > OAuthClient.MaxClientIdLength)
        {
            return null;
        }

        var client = await dbContext.OAuthClients.FirstOrDefaultAsync(item => item.ClientId == clientId, cancellationToken);

        if (!ClientMetadataFetcher.IsMetadataDocumentUrl(clientId))
        {
            return client is { IsMetadataDocument: false } ? client : null;
        }

        var now = timeProvider.GetUtcNow();
        if (client is not null && now - client.UpdatedAt < MetadataDocumentLifetime)
        {
            return client;
        }

        var metadata = await metadataFetcher.FetchAsync(clientId, cancellationToken);
        if (metadata is null)
        {
            return null;
        }

        if (client is null)
        {
            client = new OAuthClient { ClientId = clientId, IsMetadataDocument = true, CreatedAt = now };
            dbContext.OAuthClients.Add(client);
        }

        client.Name = metadata.Name;
        client.RedirectUris = [.. metadata.RedirectUris];
        client.UpdatedAt = now;

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another sign-in added the app at the same time, which fails the unique ClientId index.
            dbContext.Entry(client).State = EntityState.Detached;
            return await dbContext.OAuthClients
                .FirstOrDefaultAsync(item => item.ClientId == clientId, cancellationToken);
        }

        return client;
    }

    // The host that vouches for an app known by its metadata document, or null for one that registered itself.
    public static string? ClientHost(OAuthClient client)
    {
        ArgumentNullException.ThrowIfNull(client);

        return client.IsMetadataDocument && Uri.TryCreate(client.ClientId, UriKind.Absolute, out var uri)
            ? uri.Host
            : null;
    }

    private static OAuthRegistration Refused(string error, string description)
    {
        return new OAuthRegistration(null, new OAuthError(error, description));
    }
}
