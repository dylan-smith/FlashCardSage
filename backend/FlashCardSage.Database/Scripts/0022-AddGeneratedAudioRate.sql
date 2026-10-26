-- The Listen slowly button has the voice say a phrase more slowly, which is different audio from its normal speed, so
-- the cache keeps the two apart. Rate is the SSML prosody rate the voice was slowed to, or empty at its own speed,
-- which every row kept so far is. Like the voice, it's part of the unique index, so the index is dropped and made again
-- with it, and a change of rate starts afresh.
DROP INDEX [IX_GeneratedAudio_Voice_Text] ON [dbo].[GeneratedAudio];

ALTER TABLE [dbo].[GeneratedAudio]
    ADD [Rate] NVARCHAR(16) NOT NULL CONSTRAINT [DF_GeneratedAudio_Rate] DEFAULT N'';

CREATE UNIQUE NONCLUSTERED INDEX [IX_GeneratedAudio_Voice_Rate_Text]
    ON [dbo].[GeneratedAudio] ([Voice] ASC, [Rate] ASC, [Text] ASC)
    INCLUDE ([AudioUrl]);
