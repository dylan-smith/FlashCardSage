-- The spoken audio of every phrase the API has had the speech service read is kept here, so a phrase is only paid
-- for the first time anyone asks to hear it: a phrase sounds the same for everyone in a given voice, so like the
-- translations and pictures the rows are shared by every user and have no owner. The audio itself is in the image
-- store, at AudioUrl, under a name made from its content, and like a cached picture it's never removed.
--
-- Voice is the voice's name (es-MX-DaliaNeural, say), so a change of voice starts afresh. The voice might read "Madrid"
-- and "madrid" differently, so like the translations' text, the text is compared case-sensitively.
CREATE TABLE [dbo].[GeneratedAudio] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [Voice] NVARCHAR(64) NOT NULL,
    [Text] NVARCHAR(200) COLLATE Latin1_General_CS_AS NOT NULL,
    [AudioUrl] NVARCHAR(400) NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_GeneratedAudio] PRIMARY KEY CLUSTERED ([Id] ASC)
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_GeneratedAudio_Voice_Text]
    ON [dbo].[GeneratedAudio] ([Voice] ASC, [Text] ASC)
    INCLUDE ([AudioUrl]);
