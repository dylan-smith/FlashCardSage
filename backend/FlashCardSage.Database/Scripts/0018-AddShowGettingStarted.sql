-- Whether the Cards page shows the getting started guide. On for a new user, and off for everyone who already has an
-- account (and the system user, which never signs in), since they've found their way around already. The Preferences
-- page turns it back on. The update is its own batch, since a column can't be used in the batch that adds it.
ALTER TABLE [dbo].[Users]
    ADD [ShowGettingStarted] BIT NOT NULL CONSTRAINT [DF_Users_ShowGettingStarted] DEFAULT 1;
GO

UPDATE [dbo].[Users] SET [ShowGettingStarted] = 0;
