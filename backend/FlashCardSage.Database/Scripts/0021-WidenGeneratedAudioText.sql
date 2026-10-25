-- The Listen button reads practice sentences aloud as well as a card's words, so the spoken text can be as long as a
-- sentence: 300 characters. The column is in the unique index, so the index is dropped and made again around the
-- change, and the column keeps its case-sensitive collation and NOT NULL, which ALTER COLUMN would otherwise drop.
DROP INDEX [IX_GeneratedAudio_Voice_Text] ON [dbo].[GeneratedAudio];

ALTER TABLE [dbo].[GeneratedAudio]
    ALTER COLUMN [Text] NVARCHAR(300) COLLATE Latin1_General_CS_AS NOT NULL;

CREATE UNIQUE NONCLUSTERED INDEX [IX_GeneratedAudio_Voice_Text]
    ON [dbo].[GeneratedAudio] ([Voice] ASC, [Text] ASC)
    INCLUDE ([AudioUrl]);
