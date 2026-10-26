-- The Listen slowly button has the voice say a phrase more slowly, which is different audio from its normal speed, so
-- the cache keeps the two apart. SpeakingRate is how fast the voice spoke, as a multiple of its normal speed: 1.00,
-- which every row kept so far is, or 0.70 for slowly. Azure Speech takes 0.5 to 2. Like the voice, it's part of the
-- unique index, so the index is dropped and made again with it, and a change of rate starts afresh.
DROP INDEX [IX_GeneratedAudio_Voice_Text] ON [dbo].[GeneratedAudio];

ALTER TABLE [dbo].[GeneratedAudio]
    ADD [SpeakingRate] DECIMAL(3,2) NOT NULL CONSTRAINT [DF_GeneratedAudio_SpeakingRate] DEFAULT 1.00
        CONSTRAINT [CK_GeneratedAudio_SpeakingRate] CHECK ([SpeakingRate] BETWEEN 0.5 AND 2.0);

CREATE UNIQUE NONCLUSTERED INDEX [IX_GeneratedAudio_Voice_SpeakingRate_Text]
    ON [dbo].[GeneratedAudio] ([Voice] ASC, [SpeakingRate] ASC, [Text] ASC)
    INCLUDE ([AudioUrl]);
