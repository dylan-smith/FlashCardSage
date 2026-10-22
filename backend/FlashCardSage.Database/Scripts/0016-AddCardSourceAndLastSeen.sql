-- When cards and decks were made, and how a card was added (typed in, a suggestion, a document, Preply, Duolingo, a
-- built-in deck or an AI assistant), and when a user was last seen, so the admin pages can show how the site is used.
-- They're null for the rows made before, which show as unknown, rather than being given an invented date or source.
ALTER TABLE [dbo].[FlashCards]
    ADD [CreatedAt] DATETIMEOFFSET NULL,
        [Source] NVARCHAR(20) NULL;
GO

ALTER TABLE [dbo].[Decks]
    ADD [CreatedAt] DATETIMEOFFSET NULL;
GO

ALTER TABLE [dbo].[Users]
    ADD [LastSeenAt] DATETIMEOFFSET NULL;
