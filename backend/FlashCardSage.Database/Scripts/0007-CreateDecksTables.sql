-- Decks the user makes to practice a named set of their cards (e.g. Food or Week 1). A deck belongs to the user who
-- made it, and a user's deck names are unique (case-insensitively, by the default collation).
CREATE TABLE [dbo].[Decks] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [UserId] INT NOT NULL,
    [Name] NVARCHAR(50) NOT NULL,
    CONSTRAINT [PK_Decks] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_Decks_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_Decks_UserId_Name]
    ON [dbo].[Decks] ([UserId] ASC, [Name] ASC);

-- Which cards are in which decks. A link goes with its card. SQL Server won't allow a second cascade path from Users
-- through Decks, so the API removes a deck's links itself before it deletes the deck.
CREATE TABLE [dbo].[DeckFlashCards] (
    [DeckId] INT NOT NULL,
    [FlashCardId] INT NOT NULL,
    CONSTRAINT [PK_DeckFlashCards] PRIMARY KEY CLUSTERED ([DeckId] ASC, [FlashCardId] ASC),
    CONSTRAINT [FK_DeckFlashCards_Decks_DeckId] FOREIGN KEY ([DeckId])
        REFERENCES [dbo].[Decks] ([Id]),
    CONSTRAINT [FK_DeckFlashCards_FlashCards_FlashCardId] FOREIGN KEY ([FlashCardId])
        REFERENCES [dbo].[FlashCards] ([Id]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_DeckFlashCards_FlashCardId]
    ON [dbo].[DeckFlashCards] ([FlashCardId] ASC);
