-- Tags the user makes up to organize their cards (e.g. Food or Travel). A tag belongs to the user who made it, and a
-- user's tag names are unique (case-insensitively, by the default collation).
CREATE TABLE [dbo].[Tags] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [UserId] INT NOT NULL,
    [Name] NVARCHAR(50) NOT NULL,
    CONSTRAINT [PK_Tags] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_Tags_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_Tags_UserId_Name]
    ON [dbo].[Tags] ([UserId] ASC, [Name] ASC);

-- Which tags are on which cards. A link goes with its card. SQL Server won't allow a second cascade path from Users
-- through Tags, so the API removes a tag's links itself before it deletes the tag.
CREATE TABLE [dbo].[FlashCardTags] (
    [FlashCardId] INT NOT NULL,
    [TagId] INT NOT NULL,
    CONSTRAINT [PK_FlashCardTags] PRIMARY KEY CLUSTERED ([FlashCardId] ASC, [TagId] ASC),
    CONSTRAINT [FK_FlashCardTags_FlashCards_FlashCardId] FOREIGN KEY ([FlashCardId])
        REFERENCES [dbo].[FlashCards] ([Id]) ON DELETE CASCADE,
    CONSTRAINT [FK_FlashCardTags_Tags_TagId] FOREIGN KEY ([TagId])
        REFERENCES [dbo].[Tags] ([Id])
);

CREATE NONCLUSTERED INDEX [IX_FlashCardTags_TagId]
    ON [dbo].[FlashCardTags] ([TagId] ASC);
