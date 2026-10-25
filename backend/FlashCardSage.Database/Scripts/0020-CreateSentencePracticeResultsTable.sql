-- What the user said when they practiced a sentence in Sentences practice mode: GotIt, WasClose or Failed. It's kept
-- to learn from and doesn't count toward any card's score. A sentence uses several cards, so unlike a card's practice
-- result, a row belongs to the user directly and goes with the user if they're deleted.
--
-- CardIds is a JSON array of the ids of the user's cards the sentence used, as they were, so a card deleted since
-- keeps its id here. ShownSide is the side the user was shown first: Spanish or English. Listening is whether the
-- sentence was practiced in listening mode, heard rather than read.
CREATE TABLE [dbo].[SentencePracticeResults] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [UserId] INT NOT NULL,
    [Spanish] NVARCHAR(300) NOT NULL,
    [English] NVARCHAR(300) NOT NULL,
    [CardIds] NVARCHAR(MAX) NOT NULL,
    [ShownSide] NVARCHAR(10) NOT NULL,
    [Listening] BIT NOT NULL,
    [Outcome] NVARCHAR(20) NOT NULL,
    [PracticedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_SentencePracticeResults] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_SentencePracticeResults_Users_UserId] FOREIGN KEY ([UserId])
        REFERENCES [dbo].[Users] ([Id]) ON DELETE CASCADE
);

CREATE NONCLUSTERED INDEX [IX_SentencePracticeResults_UserId]
    ON [dbo].[SentencePracticeResults] ([UserId] ASC);
