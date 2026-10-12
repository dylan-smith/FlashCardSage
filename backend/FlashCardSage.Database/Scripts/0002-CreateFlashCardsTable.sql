-- A flash card belongs to the user who made it, and goes with them if they're deleted.
CREATE TABLE [dbo].[FlashCards] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [Title] NVARCHAR(200) NOT NULL,
    [UserId] INT NOT NULL,
    CONSTRAINT [PK_FlashCards] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_FlashCards_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_FlashCards_UserId]
    ON [dbo].[FlashCards] ([UserId] ASC);
