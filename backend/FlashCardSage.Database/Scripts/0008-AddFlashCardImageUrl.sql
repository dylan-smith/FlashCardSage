-- A card can have a picture of its meaning, kept in blob storage. This is the picture's public URL, and null for
-- a card without one.
ALTER TABLE [dbo].[FlashCards]
    ADD [ImageUrl] NVARCHAR(400) NULL;
