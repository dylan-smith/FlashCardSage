-- The user's preferences, which start out with everything on: pictures on cards, suggested cards, and translating
-- the side of a card the user types into the other side.
ALTER TABLE [dbo].[Users]
    ADD [ShowPictures] BIT NOT NULL CONSTRAINT [DF_Users_ShowPictures] DEFAULT 1,
        [ShowSuggestions] BIT NOT NULL CONSTRAINT [DF_Users_ShowSuggestions] DEFAULT 1,
        [AutoTranslate] BIT NOT NULL CONSTRAINT [DF_Users_AutoTranslate] DEFAULT 1;
