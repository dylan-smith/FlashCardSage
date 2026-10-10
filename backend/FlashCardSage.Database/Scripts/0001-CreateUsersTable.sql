-- Subject is the signed-in identity, prefixed with where it came from (e.g. "google:<sub>").
CREATE TABLE [dbo].[Users] (
    [Id] INT IDENTITY(1,1) NOT NULL,
    [Subject] NVARCHAR(255) NOT NULL,
    [Email] NVARCHAR(320) NULL,
    [DisplayName] NVARCHAR(200) NULL,
    [CreatedAt] DATETIMEOFFSET NOT NULL,
    CONSTRAINT [PK_Users] PRIMARY KEY CLUSTERED ([Id] ASC)
);

CREATE UNIQUE NONCLUSTERED INDEX [IX_Users_Subject]
    ON [dbo].[Users] ([Subject] ASC);
