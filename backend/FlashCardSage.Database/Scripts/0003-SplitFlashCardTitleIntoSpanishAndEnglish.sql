-- A card is now a Spanish word or phrase and its English translation. The old title was the Spanish side, and
-- cards made before this have no translation yet, so they get a blank one that's filled in when the card is edited.
EXEC sp_rename N'dbo.FlashCards.Title', N'Spanish', N'COLUMN';

ALTER TABLE [dbo].[FlashCards]
    ADD [English] NVARCHAR(200) NOT NULL
    CONSTRAINT [DF_FlashCards_English] DEFAULT N'';

ALTER TABLE [dbo].[FlashCards]
    DROP CONSTRAINT [DF_FlashCards_English];
