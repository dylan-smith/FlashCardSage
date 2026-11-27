-- When a user was last seen on the website and in the Android app, so the admin pages can show which of them people
-- use. They're null until the user is next seen there, since which one it was wasn't recorded before.
ALTER TABLE [dbo].[Users]
    ADD [LastSeenOnWebAt] DATETIMEOFFSET NULL,
        [LastSeenInAndroidAppAt] DATETIMEOFFSET NULL;
