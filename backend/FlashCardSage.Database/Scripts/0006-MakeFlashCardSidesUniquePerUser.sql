-- A user can't have two cards with the same Spanish or the same English (case-insensitively, by the default
-- collation). The API checks before it saves, but only the database can stop two saves at once, or a save EF Core
-- retries after its first try went through.
--
-- Cards that already clash keep their practice history: the side that clashes on each newer card gets " (2)",
-- " (3)" and so on, so the user can see them and merge them by hand. The text is shortened if it needs to be to fit
-- the suffix into 200 characters.
WITH [Clashes] AS (
    SELECT [Spanish], ROW_NUMBER() OVER (PARTITION BY [UserId], [Spanish] ORDER BY [Id]) AS [Number]
    FROM [dbo].[FlashCards]
)
UPDATE [Clashes]
SET [Spanish] = LEFT([Spanish], 200 - LEN(N' (' + CAST([Number] AS NVARCHAR(10)) + N')'))
    + N' (' + CAST([Number] AS NVARCHAR(10)) + N')'
WHERE [Number] > 1;

WITH [Clashes] AS (
    SELECT [English], ROW_NUMBER() OVER (PARTITION BY [UserId], [English] ORDER BY [Id]) AS [Number]
    FROM [dbo].[FlashCards]
)
UPDATE [Clashes]
SET [English] = LEFT([English], 200 - LEN(N' (' + CAST([Number] AS NVARCHAR(10)) + N')'))
    + N' (' + CAST([Number] AS NVARCHAR(10)) + N')'
WHERE [Number] > 1;

CREATE UNIQUE NONCLUSTERED INDEX [IX_FlashCards_UserId_Spanish]
    ON [dbo].[FlashCards] ([UserId] ASC, [Spanish] ASC);

CREATE UNIQUE NONCLUSTERED INDEX [IX_FlashCards_UserId_English]
    ON [dbo].[FlashCards] ([UserId] ASC, [English] ASC);
