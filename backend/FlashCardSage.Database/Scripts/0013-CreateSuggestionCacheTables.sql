-- The last suggestions the API got from the suggestion model for each request a user has made, so opening the cards
-- page or the Tags page again with nothing changed shows the same suggestions instead of paying for new ones. Unlike
-- the translations and pictures, the requests are made from the user's own cards, so each row belongs to a user.
-- Asking for fresh suggestions replaces the row, and only a user's most recent rows are kept.
--
-- PromptHash is the SHA-256, as lowercase hex, of the instructions and the request sent to the model, which describe
-- the user's cards and tags, so any change to them (or to the prompt) starts afresh. Suggestions is a JSON array, as
-- the model returned them: of {"spanish", "english"} objects for cards, and of names for tags.
CREATE TABLE [dbo].[CardSuggestions] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [UserId] INT NOT NULL,
    [PromptHash] CHAR(64) NOT NULL,
    [Suggestions] NVARCHAR(MAX) NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_CardSuggestions] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_CardSuggestions_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_CardSuggestions_UserId_PromptHash]
    ON [dbo].[CardSuggestions] ([UserId] ASC, [PromptHash] ASC);

-- The new tags suggested on the Tags page.
CREATE TABLE [dbo].[TagSuggestions] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [UserId] INT NOT NULL,
    [PromptHash] CHAR(64) NOT NULL,
    [Suggestions] NVARCHAR(MAX) NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_TagSuggestions] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_TagSuggestions_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_TagSuggestions_UserId_PromptHash]
    ON [dbo].[TagSuggestions] ([UserId] ASC, [PromptHash] ASC);
