-- Whether the card was practiced in listening mode, heard rather than read, so the admin pages can show how many
-- people practice that way. It's null for the results recorded before, since nobody knows how those were practiced.
ALTER TABLE [dbo].[PracticeResults]
    ADD [Listening] BIT NULL;
