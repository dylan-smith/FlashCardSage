-- Every translation the API gets from Azure AI Translator is kept here, so a text is only paid for the first time
-- anyone types it: the same text always translates the same way, so the rows are shared by every user and have no
-- owner. Alternatives is a JSON array of a word's other meanings, as the translation endpoint returns them.
--
-- The translation depends on the text's case ("madrid" is lowercased like any lowercase text, "Madrid" is left as
-- translated), so unlike the words' indexes, which use the default case-insensitive collation on purpose, the
-- text is compared case-sensitively.
CREATE TABLE [dbo].[Translations] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [FromLanguage] NVARCHAR(10) NOT NULL,
    [Text] NVARCHAR(200) COLLATE Latin1_General_CS_AS NOT NULL,
    [Translation] NVARCHAR(MAX) NOT NULL,
    [Alternatives] NVARCHAR(MAX) NOT NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_Translations] PRIMARY KEY CLUSTERED ([Id] ASC)
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_Translations_FromLanguage_Text]
    ON [dbo].[Translations] ([FromLanguage] ASC, [Text] ASC);
