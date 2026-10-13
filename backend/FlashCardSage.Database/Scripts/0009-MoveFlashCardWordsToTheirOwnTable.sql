-- A card can have more than one Spanish word and more than one English word for the same meaning (e.g. "solo" and
-- "únicamente" for "only"), so its words move to a table of their own. Position keeps them in the order the user
-- typed them, and the first of each language is the card's main word.
--
-- A word is still on only one of a user's cards (case-insensitively, by the default collation), as 0006 made the
-- card's sides, so the user always knows which card an answer belongs to. The owner is copied onto each word for
-- that unique index, and the foreign key to the card includes it, so it can't differ from the card's. Deleting a
-- user deletes their cards, and the cards' words with them, so there's one cascade path.
CREATE UNIQUE NONCLUSTERED INDEX [IX_FlashCards_Id_UserId]
    ON [dbo].[FlashCards] ([Id] ASC, [UserId] ASC);

CREATE TABLE [dbo].[FlashCardWords] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [FlashCardId] INT NOT NULL,
    [UserId] INT NOT NULL,
    [Language] NVARCHAR(10) NOT NULL,
    [Text] NVARCHAR(200) NOT NULL,
    [Position] INT NOT NULL,
    CONSTRAINT [PK_FlashCardWords] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_FlashCardWords_FlashCards_FlashCardId_UserId] FOREIGN KEY ([FlashCardId], [UserId])
        REFERENCES [dbo].[FlashCards] ([Id], [UserId]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_FlashCardWords_FlashCardId]
    ON [dbo].[FlashCardWords] ([FlashCardId] ASC);

CREATE UNIQUE NONCLUSTERED INDEX [IX_FlashCardWords_UserId_Language_Text]
    ON [dbo].[FlashCardWords] ([UserId] ASC, [Language] ASC, [Text] ASC);

-- Every card so far has one word in each language. One typed as "a / b" stays that way until the user splits it.
INSERT INTO [dbo].[FlashCardWords] ([FlashCardId], [UserId], [Language], [Text], [Position])
SELECT [Id], [UserId], N'Spanish', [Spanish], 0
FROM [dbo].[FlashCards];

INSERT INTO [dbo].[FlashCardWords] ([FlashCardId], [UserId], [Language], [Text], [Position])
SELECT [Id], [UserId], N'English', [English], 0
FROM [dbo].[FlashCards];

DROP INDEX [IX_FlashCards_UserId_Spanish] ON [dbo].[FlashCards];

DROP INDEX [IX_FlashCards_UserId_English] ON [dbo].[FlashCards];

ALTER TABLE [dbo].[FlashCards]
    DROP COLUMN [Spanish], [English];
