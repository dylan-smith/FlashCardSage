-- Every picture the API gets from the image generator is kept here, so the same words are only paid for when nobody
-- has had a picture of them yet, or the user has looked through all the ones there are and asks for another. Like
-- the translations, the rows are shared by every user and have no owner. A prompt has as many pictures as were made
-- for it, oldest first by Id.
--
-- PromptHash is the SHA-256, as lowercase hex, of the lowercased prompt the generator was sent, so a change to the
-- prompt starts afresh. ImageUrl is the picture's public URL in the image store. A card given the picture points at
-- the same URL, so the file is never removed.
CREATE TABLE [dbo].[GeneratedImages] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [PromptHash] CHAR(64) NOT NULL,
    [ImageUrl] NVARCHAR(400) NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_GeneratedImages] PRIMARY KEY CLUSTERED ([Id] ASC)
);

CREATE NONCLUSTERED INDEX [IX_GeneratedImages_PromptHash_Id]
    ON [dbo].[GeneratedImages] ([PromptHash] ASC, [Id] ASC)
    INCLUDE ([ImageUrl]);
