-- The built-in decks' words were reviewed for Mexican Spanish: Spain-only words like "zumo" and "patata" go, the
-- word a Mexican says first (e.g. "la chamarra", "la recámara", "el carro") comes first, and a few English glosses
-- are corrected. The API only adds built-in decks that are missing, and leaves one that's already there as it is, so
-- the system user's cards that changed get their new words here, and keep their pictures and ids. Each card is found
-- by its old first Spanish word, and its words are replaced with the new ones in order. Users who imported a deck
-- have their own copy of its cards, which is left alone as it always is.
DECLARE @SystemUserId INT = (SELECT [Id] FROM [dbo].[Users] WHERE [Subject] = N'system');

IF @SystemUserId IS NOT NULL
BEGIN
    DECLARE @Words TABLE (
        [OldSpanish] NVARCHAR(200) NOT NULL,
        [Language] NVARCHAR(10) NOT NULL,
        [Text] NVARCHAR(200) NOT NULL,
        [Position] INT NOT NULL
    );

    INSERT INTO @Words ([OldSpanish], [Language], [Text], [Position])
    VALUES
        (N'marrón', N'Spanish', N'café', 0),
        (N'marrón', N'Spanish', N'marrón', 1),
        (N'marrón', N'English', N'brown', 0),
        (N'celeste', N'Spanish', N'azul claro', 0),
        (N'celeste', N'Spanish', N'celeste', 1),
        (N'celeste', N'English', N'light blue', 0),
        (N'disculpe', N'Spanish', N'disculpe', 0),
        (N'disculpe', N'Spanish', N'disculpa', 1),
        (N'disculpe', N'English', N'excuse me', 0),
        (N'la comida', N'Spanish', N'la comida', 0),
        (N'la comida', N'English', N'food', 0),
        (N'la comida', N'English', N'lunch', 1),
        (N'el almuerzo', N'Spanish', N'el almuerzo', 0),
        (N'el almuerzo', N'English', N'mid-morning meal', 0),
        (N'el almuerzo', N'English', N'brunch', 1),
        (N'la carne de cerdo', N'Spanish', N'la carne de puerco', 0),
        (N'la carne de cerdo', N'Spanish', N'la carne de cerdo', 1),
        (N'la carne de cerdo', N'English', N'pork', 0),
        (N'el plátano', N'Spanish', N'el plátano', 0),
        (N'el plátano', N'English', N'banana', 0),
        (N'el limón', N'Spanish', N'el limón', 0),
        (N'el limón', N'English', N'lime', 0),
        (N'el limón', N'English', N'lemon', 1),
        (N'el durazno', N'Spanish', N'el durazno', 0),
        (N'el durazno', N'English', N'peach', 0),
        (N'la papa', N'Spanish', N'la papa', 0),
        (N'la papa', N'English', N'potato', 0),
        (N'el tomate', N'Spanish', N'el jitomate', 0),
        (N'el tomate', N'Spanish', N'el tomate', 1),
        (N'el tomate', N'English', N'tomato', 0),
        (N'el pimiento', N'Spanish', N'el chile morrón', 0),
        (N'el pimiento', N'Spanish', N'el pimiento morrón', 1),
        (N'el pimiento', N'English', N'bell pepper', 0),
        (N'el jugo', N'Spanish', N'el jugo', 0),
        (N'el jugo', N'English', N'juice', 0),
        (N'el agua con gas', N'Spanish', N'el agua mineral', 0),
        (N'el agua con gas', N'Spanish', N'el agua con gas', 1),
        (N'el agua con gas', N'English', N'sparkling water', 0),
        (N'el mesero', N'Spanish', N'el mesero', 0),
        (N'el mesero', N'Spanish', N'la mesera', 1),
        (N'el mesero', N'English', N'waiter', 0),
        (N'el mesero', N'English', N'waitress', 1),
        (N'el apartamento', N'Spanish', N'el departamento', 0),
        (N'el apartamento', N'Spanish', N'el apartamento', 1),
        (N'el apartamento', N'English', N'apartment', 0),
        (N'el dormitorio', N'Spanish', N'la recámara', 0),
        (N'el dormitorio', N'Spanish', N'el cuarto', 1),
        (N'el dormitorio', N'Spanish', N'la habitación', 2),
        (N'el dormitorio', N'English', N'bedroom', 0),
        (N'la sala', N'Spanish', N'la sala', 0),
        (N'la sala', N'English', N'living room', 0),
        (N'el suelo', N'Spanish', N'el piso', 0),
        (N'el suelo', N'Spanish', N'el suelo', 1),
        (N'el suelo', N'English', N'floor', 0),
        (N'el armario', N'Spanish', N'el clóset', 0),
        (N'el armario', N'Spanish', N'el armario', 1),
        (N'el armario', N'English', N'closet', 0),
        (N'el armario', N'English', N'wardrobe', 1),
        (N'la ducha', N'Spanish', N'la regadera', 0),
        (N'la ducha', N'Spanish', N'la ducha', 1),
        (N'la ducha', N'English', N'shower', 0),
        (N'el refrigerador', N'Spanish', N'el refrigerador', 0),
        (N'el refrigerador', N'Spanish', N'el refri', 1),
        (N'el refrigerador', N'English', N'refrigerator', 0),
        (N'el refrigerador', N'English', N'fridge', 1),
        (N'el garaje', N'Spanish', N'el garaje', 0),
        (N'el garaje', N'Spanish', N'la cochera', 1),
        (N'el garaje', N'English', N'garage', 0),
        (N'la camiseta', N'Spanish', N'la playera', 0),
        (N'la camiseta', N'Spanish', N'la camiseta', 1),
        (N'la camiseta', N'English', N'T-shirt', 0),
        (N'los pantalones cortos', N'Spanish', N'los shorts', 0),
        (N'los pantalones cortos', N'Spanish', N'los pantalones cortos', 1),
        (N'los pantalones cortos', N'English', N'shorts', 0),
        (N'los jeans', N'Spanish', N'los jeans', 0),
        (N'los jeans', N'Spanish', N'los pantalones de mezclilla', 1),
        (N'los jeans', N'English', N'jeans', 0),
        (N'la chaqueta', N'Spanish', N'la chamarra', 0),
        (N'la chaqueta', N'English', N'jacket', 0),
        (N'el pijama', N'Spanish', N'la pijama', 0),
        (N'el pijama', N'English', N'pajamas', 0),
        (N'las gafas', N'Spanish', N'los lentes', 0),
        (N'las gafas', N'Spanish', N'las gafas', 1),
        (N'las gafas', N'English', N'glasses', 0),
        (N'el cerdo', N'Spanish', N'el cerdo', 0),
        (N'el cerdo', N'Spanish', N'el puerco', 1),
        (N'el cerdo', N'English', N'pig', 0),
        (N'el médico', N'Spanish', N'el doctor', 0),
        (N'el médico', N'Spanish', N'la doctora', 1),
        (N'el médico', N'Spanish', N'el médico', 2),
        (N'el médico', N'Spanish', N'la médica', 3),
        (N'el médico', N'English', N'doctor', 0),
        (N'el ayuntamiento', N'Spanish', N'el palacio municipal', 0),
        (N'el ayuntamiento', N'Spanish', N'el ayuntamiento', 1),
        (N'el ayuntamiento', N'English', N'city hall', 0),
        (N'el coche', N'Spanish', N'el carro', 0),
        (N'el coche', N'Spanish', N'el coche', 1),
        (N'el coche', N'Spanish', N'el auto', 2),
        (N'el coche', N'English', N'car', 0),
        (N'el autobús', N'Spanish', N'el autobús', 0),
        (N'el autobús', N'Spanish', N'el camión', 1),
        (N'el autobús', N'English', N'bus', 0),
        (N'el boleto', N'Spanish', N'el boleto', 0),
        (N'el boleto', N'English', N'ticket', 0),
        (N'todo recto', N'Spanish', N'derecho', 0),
        (N'todo recto', N'Spanish', N'todo derecho', 1),
        (N'todo recto', N'English', N'straight ahead', 0),
        (N'allí', N'Spanish', N'ahí', 0),
        (N'allí', N'Spanish', N'allí', 1),
        (N'allí', N'English', N'there', 0),
        (N'menos cuarto', N'Spanish', N'cuarto para', 0),
        (N'menos cuarto', N'Spanish', N'menos cuarto', 1),
        (N'menos cuarto', N'English', N'quarter to', 0),
        (N'anteayer', N'Spanish', N'anteayer', 0),
        (N'anteayer', N'Spanish', N'antier', 1),
        (N'anteayer', N'English', N'the day before yesterday', 0),
        (N'luego', N'Spanish', N'luego', 0),
        (N'luego', N'Spanish', N'al rato', 1),
        (N'luego', N'English', N'later', 0),
        (N'a menudo', N'Spanish', N'a menudo', 0),
        (N'a menudo', N'Spanish', N'seguido', 1),
        (N'a menudo', N'English', N'often', 0),
        (N'el tiempo', N'Spanish', N'el clima', 0),
        (N'el tiempo', N'Spanish', N'el tiempo', 1),
        (N'el tiempo', N'English', N'weather', 0),
        (N'¿Qué tiempo hace?', N'Spanish', N'¿Cómo está el clima?', 0),
        (N'¿Qué tiempo hace?', N'Spanish', N'¿Qué tiempo hace?', 1),
        (N'¿Qué tiempo hace?', N'English', N'What''s the weather like?', 0),
        (N'Llueve.', N'Spanish', N'Está lloviendo.', 0),
        (N'Llueve.', N'Spanish', N'Llueve.', 1),
        (N'Llueve.', N'English', N'It''s raining.', 0),
        (N'Nieva.', N'Spanish', N'Está nevando.', 0),
        (N'Nieva.', N'Spanish', N'Nieva.', 1),
        (N'Nieva.', N'English', N'It''s snowing.', 0),
        (N'tomar', N'Spanish', N'tomar', 0),
        (N'tomar', N'English', N'to take', 0),
        (N'tomar', N'English', N'to have (a drink)', 1),
        (N'avergonzado', N'Spanish', N'apenado', 0),
        (N'avergonzado', N'Spanish', N'avergonzado', 1),
        (N'avergonzado', N'English', N'embarrassed', 0),
        (N'Solo estoy mirando.', N'Spanish', N'Solo estoy viendo.', 0),
        (N'Solo estoy mirando.', N'Spanish', N'Solo estoy mirando.', 1),
        (N'Solo estoy mirando.', N'English', N'I''m just looking.', 0),
        (N'¡Ayuda!', N'Spanish', N'¡Ayuda!', 0),
        (N'¡Ayuda!', N'Spanish', N'¡Auxilio!', 1),
        (N'¡Ayuda!', N'English', N'Help!', 0),
        (N'el resfriado', N'Spanish', N'el resfriado', 0),
        (N'el resfriado', N'English', N'cold (illness)', 0);

    DECLARE @Cards TABLE ([OldSpanish] NVARCHAR(200) NOT NULL, [FlashCardId] INT NOT NULL);

    INSERT INTO @Cards ([OldSpanish], [FlashCardId])
    SELECT [Text], [FlashCardId]
    FROM [dbo].[FlashCardWords]
    WHERE [UserId] = @SystemUserId
        AND [Language] = N'Spanish'
        AND [Position] = 0
        AND [Text] IN (SELECT [OldSpanish] FROM @Words);

    -- All the changed cards' words go first, so a word that moves between cards doesn't clash with itself.
    DELETE [Word]
    FROM [dbo].[FlashCardWords] AS [Word]
    INNER JOIN @Cards AS [Card] ON [Card].[FlashCardId] = [Word].[FlashCardId];

    INSERT INTO [dbo].[FlashCardWords] ([FlashCardId], [UserId], [Language], [Text], [Position])
    SELECT [Card].[FlashCardId], @SystemUserId, [Word].[Language], [Word].[Text], [Word].[Position]
    FROM @Words AS [Word]
    INNER JOIN @Cards AS [Card] ON [Card].[OldSpanish] = [Word].[OldSpanish];
END
