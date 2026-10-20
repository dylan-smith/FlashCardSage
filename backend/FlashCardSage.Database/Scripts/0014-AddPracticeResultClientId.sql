-- Practice works offline: the device keeps each answer with an id of its own and sends it when it's back online. The
-- id is kept with the result, so an answer the device sends again (say, when the response to the first try was lost)
-- is only recorded once. It's null for the results recorded before, so they aren't given an invented id, and the
-- unique index leaves them out, so it starts empty.
ALTER TABLE [dbo].[PracticeResults]
    ADD [ClientId] UNIQUEIDENTIFIER NULL;
GO

CREATE UNIQUE NONCLUSTERED INDEX [IX_PracticeResults_ClientId]
    ON [dbo].[PracticeResults] ([ClientId] ASC)
    WHERE [ClientId] IS NOT NULL;
