-- The API is an OAuth 2.1 authorization server for AI assistants (MCP clients such as Claude and ChatGPT), which sign
-- in on the user's behalf and are given tokens of the API's own. These four tables hold that: the apps, the sign-ins
-- in progress, the apps a user has connected, and their tokens. Every code and token is kept only as the SHA-256, as
-- lowercase hex, of the value, so the database never holds one that works.
--
-- An app either registered itself (dynamic client registration), when ClientId is a random "fcs_c_..." the API made,
-- or is named by the https URL of a document describing it (a client ID metadata document), which the API fetches
-- and keeps here. RedirectUris is a JSON array of the URLs the app may be sent back to.
CREATE TABLE [dbo].[OAuthClients] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [ClientId] NVARCHAR(512) NOT NULL,
    [Name] NVARCHAR(200) NULL,
    [RedirectUris] NVARCHAR(MAX) NOT NULL,
    [IsMetadataDocument] BIT NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    [UpdatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_OAuthClients] PRIMARY KEY CLUSTERED ([Id] ASC)
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_OAuthClients_ClientId]
    ON [dbo].[OAuthClients] ([ClientId] ASC);

-- A sign-in in progress. The row is made when the app sends the user to the API, before anyone has signed in, and its
-- random Id is all the frontend's consent page gets. Approving it sets the user, and the code the app is sent back
-- with, which it can redeem once before ExpiresAt (moved on to the code's expiry). TokenFamilyId is the tokens the
-- code was redeemed for, so a code used twice can revoke them.
CREATE TABLE [dbo].[OAuthAuthorizationRequests] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [OAuthClientId] INT NOT NULL,
    [RedirectUri] NVARCHAR(2000) NOT NULL,
    [Scope] NVARCHAR(200) NOT NULL,
    [State] NVARCHAR(1000) NULL,
    [CodeChallenge] VARCHAR(128) NOT NULL,
    [Resource] NVARCHAR(2000) NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    [ExpiresAt] DATETIMEOFFSET NOT NULL,
    [UserId] INT NULL,
    [CodeHash] CHAR(64) NULL,
    [ApprovedAt] DATETIMEOFFSET NULL,
    [RedeemedAt] DATETIMEOFFSET NULL,
    [TokenFamilyId] UNIQUEIDENTIFIER NULL,
    CONSTRAINT [PK_OAuthAuthorizationRequests] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_OAuthAuthorizationRequests_OAuthClients_OAuthClientId] FOREIGN KEY ([OAuthClientId])
        REFERENCES [dbo].[OAuthClients] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_OAuthAuthorizationRequests_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE
);
CREATE NONCLUSTERED INDEX [IX_OAuthAuthorizationRequests_OAuthClientId]
    ON [dbo].[OAuthAuthorizationRequests] ([OAuthClientId] ASC);

CREATE NONCLUSTERED INDEX [IX_OAuthAuthorizationRequests_UserId]
    ON [dbo].[OAuthAuthorizationRequests] ([UserId] ASC);

-- Only approved requests have a code.
CREATE UNIQUE NONCLUSTERED INDEX [IX_OAuthAuthorizationRequests_CodeHash]
    ON [dbo].[OAuthAuthorizationRequests] ([CodeHash] ASC)
    WHERE [CodeHash] IS NOT NULL;

-- An app a user has connected: one row for each user and app, which the Connected apps list shows. Deleting it
-- disconnects the app, and deletes its tokens with it.
CREATE TABLE [dbo].[OAuthGrants] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [UserId] INT NOT NULL,
    [OAuthClientId] INT NOT NULL,
    [Scope] NVARCHAR(200) NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    [LastUsedAt] DATETIMEOFFSET NULL,
    CONSTRAINT [PK_OAuthGrants] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_OAuthGrants_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_OAuthGrants_OAuthClients_OAuthClientId] FOREIGN KEY ([OAuthClientId])
        REFERENCES [dbo].[OAuthClients] ([Id]) ON DELETE CASCADE
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_OAuthGrants_UserId_OAuthClientId]
    ON [dbo].[OAuthGrants] ([UserId] ASC, [OAuthClientId] ASC);

CREATE NONCLUSTERED INDEX [IX_OAuthGrants_OAuthClientId]
    ON [dbo].[OAuthGrants] ([OAuthClientId] ASC);

-- The access and refresh tokens a connected app has. Each sign-in starts a family, which every refresh carries on, so
-- a refresh token used twice can revoke the whole family. Kind is "Access" or "Refresh".
CREATE TABLE [dbo].[OAuthTokens] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [GrantId] INT NOT NULL,
    [FamilyId] UNIQUEIDENTIFIER NOT NULL,
    [Kind] NVARCHAR(10) NOT NULL,
    [TokenHash] CHAR(64) NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    [ExpiresAt] DATETIMEOFFSET NOT NULL,
    [UsedAt] DATETIMEOFFSET NULL,
    CONSTRAINT [PK_OAuthTokens] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_OAuthTokens_OAuthGrants_GrantId] FOREIGN KEY ([GrantId])
        REFERENCES [dbo].[OAuthGrants] ([Id]) ON DELETE CASCADE
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_OAuthTokens_TokenHash]
    ON [dbo].[OAuthTokens] ([TokenHash] ASC);

CREATE NONCLUSTERED INDEX [IX_OAuthTokens_GrantId]
    ON [dbo].[OAuthTokens] ([GrantId] ASC);

CREATE NONCLUSTERED INDEX [IX_OAuthTokens_FamilyId]
    ON [dbo].[OAuthTokens] ([FamilyId] ASC);
