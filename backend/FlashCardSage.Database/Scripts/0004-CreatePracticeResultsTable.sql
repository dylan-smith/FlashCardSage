-- What the user said when they practiced a card: GotIt, WasClose or Failed. A result belongs to its card's owner
-- through the card, and goes with the card if it's deleted.
CREATE TABLE [dbo].[PracticeResults] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [FlashCardId] INT NOT NULL,
    [Outcome] NVARCHAR(20) NOT NULL,
    [PracticedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_PracticeResults] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_PracticeResults_FlashCards_FlashCardId] FOREIGN KEY ([FlashCardId])
        REFERENCES [dbo].[FlashCards] ([Id]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_PracticeResults_FlashCardId]
    ON [dbo].[PracticeResults] ([FlashCardId] ASC);
