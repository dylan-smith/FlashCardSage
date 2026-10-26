using System.Text.Json;
using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Models;
using FlashCardSage.Api.Suggestions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace FlashCardSage.Api.Data;

/// <remarks>
/// Flash cards belong to a user. A query filter only shows the current user's, and new ones are given the current
/// user when they're saved, so the controllers never handle the owner themselves. Tags and decks work the same way.
/// Practice results and a card's words are filtered through their card, so they're only the current user's too, and
/// a card's tags are only reached through the card. A deck only gets cards that were found through the filter, and
/// cached card suggestions and sentence practice results are owned like cards, since they're made from several of the
/// user's cards. The
/// built-in decks belong to the system user (see SystemDeckSeeder), and only SystemDeckImporter reads them past
/// the filter. Cached translations and generated pictures are the exception: they're shared by every user, so they
/// have no owner and no filter. So are the OAuth server's apps, sign-ins in progress and tokens: they're looked up
/// before anyone is signed in, and a token reaches its grant, which is owned like a card (one for each app a user has
/// connected), past the grants' filter.
/// </remarks>
public class FlashCardDbContext(
    DbContextOptions<FlashCardDbContext> options, CurrentUser currentUser, TimeProvider timeProvider) : DbContext(options)
{
    // Read by the query filter each time a query runs, so it's this request's user.
    private int? CurrentUserId => currentUser.UserId;

    public DbSet<User> Users => Set<User>();

    public DbSet<FlashCard> FlashCards => Set<FlashCard>();

    public DbSet<FlashCardWord> FlashCardWords => Set<FlashCardWord>();

    public DbSet<PracticeResult> PracticeResults => Set<PracticeResult>();

    public DbSet<SentencePracticeResult> SentencePracticeResults => Set<SentencePracticeResult>();

    public DbSet<Tag> Tags => Set<Tag>();

    public DbSet<Deck> Decks => Set<Deck>();

    public DbSet<CachedTranslation> Translations => Set<CachedTranslation>();

    public DbSet<CachedImage> GeneratedImages => Set<CachedImage>();

    public DbSet<CachedAudio> GeneratedAudio => Set<CachedAudio>();

    public DbSet<CachedCardSuggestions> CardSuggestions => Set<CachedCardSuggestions>();

    public DbSet<CachedTagSuggestions> TagSuggestions => Set<CachedTagSuggestions>();

    public DbSet<OAuthClient> OAuthClients => Set<OAuthClient>();

    public DbSet<OAuthAuthorizationRequest> OAuthAuthorizationRequests => Set<OAuthAuthorizationRequest>();

    public DbSet<OAuthGrant> OAuthGrants => Set<OAuthGrant>();

    public DbSet<OAuthToken> OAuthTokens => Set<OAuthToken>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        AssignOwner();
        StampCreated();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        AssignOwner();
        StampCreated();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    // Cards, tags and decks, and words, which are only added to cards found through the filter, so the current user
    // is the card's owner.
    private void AssignOwner()
    {
        foreach (var entry in ChangeTracker.Entries<IUserOwned>().Where(entry => entry.State == EntityState.Added))
        {
            entry.Entity.UserId = CurrentUserId
                ?? throw new InvalidOperationException(
                    $"A {entry.Metadata.ClrType.Name} can only be saved for a signed-in user.");
        }
    }

    // New cards and decks are given the time they're saved, however they were made.
    private void StampCreated()
    {
        var now = timeProvider.GetUtcNow();
        foreach (var entry in ChangeTracker.Entries<FlashCard>().Where(entry => entry.State == EntityState.Added))
        {
            entry.Entity.CreatedAt ??= now;
        }

        foreach (var entry in ChangeTracker.Entries<Deck>().Where(entry => entry.State == EntityState.Added))
        {
            entry.Entity.CreatedAt ??= now;
        }
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureUser(modelBuilder.Entity<User>());
        ConfigureFlashCard(OwnedBy<FlashCard>(modelBuilder));
        ConfigureFlashCardWord(modelBuilder.Entity<FlashCardWord>());
        ConfigurePracticeResult(modelBuilder.Entity<PracticeResult>());
        ConfigureSentencePracticeResult(OwnedBy<SentencePracticeResult>(modelBuilder));
        ConfigureTag(OwnedBy<Tag>(modelBuilder));
        ConfigureDeck(OwnedBy<Deck>(modelBuilder));
        ConfigureCachedTranslation(modelBuilder.Entity<CachedTranslation>());
        ConfigureCachedImage(modelBuilder.Entity<CachedImage>());
        ConfigureCachedAudio(modelBuilder.Entity<CachedAudio>());
        ConfigureCachedCardSuggestions(OwnedBy<CachedCardSuggestions>(modelBuilder));
        ConfigureCachedSuggestions<CachedTagSuggestions, string>(OwnedBy<CachedTagSuggestions>(modelBuilder));
        ConfigureOAuthClient(modelBuilder.Entity<OAuthClient>());
        ConfigureOAuthAuthorizationRequest(modelBuilder.Entity<OAuthAuthorizationRequest>());
        ConfigureOAuthGrant(OwnedBy<OAuthGrant>(modelBuilder));
        ConfigureOAuthToken(modelBuilder.Entity<OAuthToken>());
    }

    // Only the current user's rows are found, and deleting a user deletes theirs.
    private EntityTypeBuilder<T> OwnedBy<T>(ModelBuilder modelBuilder)
        where T : class, IUserOwned
    {
        var entity = modelBuilder.Entity<T>();

        entity.HasQueryFilter(item => item.UserId == CurrentUserId);

        entity.HasOne<User>()
            .WithMany()
            .HasForeignKey(nameof(IUserOwned.UserId))
            .OnDelete(DeleteBehavior.Cascade);

        return entity;
    }

    private static void ConfigureUser(EntityTypeBuilder<User> user)
    {
        user.HasIndex(item => item.Subject)
            .IsUnique();

        user.Property(item => item.Subject)
            .HasMaxLength(255)
            .IsRequired();

        user.Property(item => item.Email)
            .HasMaxLength(320);

        user.Property(item => item.DisplayName)
            .HasMaxLength(200);
    }

    private static void ConfigureFlashCard(EntityTypeBuilder<FlashCard> card)
    {
        card.HasIndex(item => item.UserId);

        card.Property(item => item.ImageUrl)
            .HasMaxLength(FlashCard.MaxImageUrlLength);

        card.Property(item => item.Source)
            .HasConversion<string>()
            .HasMaxLength(20);

        // The database's foreign key also includes the owner, so a word's owner is always its card's
        // (0009-*.sql). EF only needs the card.
        card.HasMany(item => item.Words)
            .WithOne()
            .HasForeignKey(word => word.FlashCardId)
            .OnDelete(DeleteBehavior.Cascade);

        // The database only cascades from the card (see 0005-CreateTagsTables.sql), so EF deletes a tag's links,
        // which needs the tag's cards loaded when it's removed.
        card.HasMany(item => item.Tags)
            .WithMany(tag => tag.FlashCards)
            .UsingEntity<Dictionary<string, object>>(
                "FlashCardTags",
                link => link.HasOne<Tag>().WithMany().HasForeignKey("TagId").OnDelete(DeleteBehavior.ClientCascade),
                link => link.HasOne<FlashCard>().WithMany().HasForeignKey("FlashCardId").OnDelete(DeleteBehavior.Cascade),
                link =>
                {
                    link.HasKey("FlashCardId", "TagId");
                    link.HasIndex("TagId");
                });
    }

    private void ConfigureFlashCardWord(EntityTypeBuilder<FlashCardWord> word)
    {
        // Filtered by its own copy of the owner, which its card gives it (see FlashCardWord).
        word.HasQueryFilter(item => item.UserId == CurrentUserId);

        word.HasIndex(item => item.FlashCardId);

        // A user has one card for a word, so no word can be on two of their cards (0009-*.sql).
        word.HasIndex(item => new { item.UserId, item.Language, item.Text })
            .IsUnique();

        word.Property(item => item.Language)
            .HasConversion<string>()
            .HasMaxLength(10);

        word.Property(item => item.Text)
            .HasMaxLength(FlashCard.MaxWordLength)
            .IsRequired();
    }

    private void ConfigurePracticeResult(EntityTypeBuilder<PracticeResult> result)
    {
        result.HasQueryFilter(item => item.FlashCard.UserId == CurrentUserId);

        result.HasOne(item => item.FlashCard)
            .WithMany()
            .HasForeignKey(item => item.FlashCardId)
            .OnDelete(DeleteBehavior.Cascade);

        result.HasIndex(item => item.FlashCardId);

        // Filtered to the results that have one in the database (0014-*.sql).
        result.HasIndex(item => item.ClientId)
            .IsUnique();

        result.Property(item => item.Outcome)
            .HasConversion<string>()
            .HasMaxLength(20);
    }

    // A sentence uses several cards, so its result is owned like a card rather than reached through one, and the
    // cards' ids are kept as a JSON array, so a deleted card's id stays (0020-*.sql).
    private static void ConfigureSentencePracticeResult(EntityTypeBuilder<SentencePracticeResult> result)
    {
        result.HasIndex(item => item.UserId);

        result.Property(item => item.Spanish)
            .HasMaxLength(SentencePracticeResult.MaxSentenceLength)
            .IsRequired();

        result.Property(item => item.English)
            .HasMaxLength(SentencePracticeResult.MaxSentenceLength)
            .IsRequired();

        result.Property(item => item.CardIds)
            .HasConversion(
                value => JsonSerializer.Serialize(value, JsonSerializerOptions.Web),
                json => JsonSerializer.Deserialize<List<int>>(json, JsonSerializerOptions.Web) ?? new List<int>(),
                new ValueComparer<List<int>>(
                    (left, right) => left!.SequenceEqual(right!),
                    value => value.Aggregate(0, (hash, item) => HashCode.Combine(hash, item)),
                    value => value.ToList()))
            .IsRequired();

        result.Property(item => item.ShownSide)
            .HasConversion<string>()
            .HasMaxLength(10);

        result.Property(item => item.Outcome)
            .HasConversion<string>()
            .HasMaxLength(20);
    }

    private static void ConfigureTag(EntityTypeBuilder<Tag> tag)
    {
        tag.HasIndex(item => new { item.UserId, item.Name })
            .IsUnique();

        tag.Property(item => item.Name)
            .HasMaxLength(Tag.MaxNameLength)
            .IsRequired();
    }

    private static void ConfigureDeck(EntityTypeBuilder<Deck> deck)
    {
        deck.HasIndex(item => new { item.UserId, item.Name })
            .IsUnique();

        deck.Property(item => item.Name)
            .HasMaxLength(Deck.MaxNameLength)
            .IsRequired();

        // Like a tag's links, the database only cascades from the card (see 0007-CreateDecksTables.sql), so EF
        // deletes a deck's links, which needs the deck's cards loaded when it's removed.
        deck.HasMany(item => item.FlashCards)
            .WithMany(card => card.Decks)
            .UsingEntity<Dictionary<string, object>>(
                "DeckFlashCards",
                link => link.HasOne<FlashCard>().WithMany().HasForeignKey("FlashCardId").OnDelete(DeleteBehavior.Cascade),
                link => link.HasOne<Deck>().WithMany().HasForeignKey("DeckId").OnDelete(DeleteBehavior.ClientCascade),
                link =>
                {
                    link.HasKey("DeckId", "FlashCardId");
                    link.HasIndex("FlashCardId");
                });
    }

    // Not owned: a text is translated the same way for everyone, so there's one row for it, shared by every user.
    private static void ConfigureCachedTranslation(EntityTypeBuilder<CachedTranslation> translation)
    {
        // The translation's case follows the text's, so the text is compared case-sensitively (0011-*.sql).
        translation.HasIndex(item => new { item.FromLanguage, item.Text })
            .IsUnique();

        translation.Property(item => item.FromLanguage)
            .HasConversion<string>()
            .HasMaxLength(10);

        translation.Property(item => item.Text)
            .HasMaxLength(FlashCard.MaxWordLength)
            .UseCollation("Latin1_General_CS_AS")
            .IsRequired();

        translation.Property(item => item.Translation)
            .IsRequired();
    }

    // Not owned either: a picture of some words suits anyone, so every user's pictures are shared, many to a prompt.
    private static void ConfigureCachedImage(EntityTypeBuilder<CachedImage> image)
    {
        image.HasIndex(item => new { item.PromptHash, item.Id });

        image.Property(item => item.PromptHash)
            .HasMaxLength(CachedImage.PromptHashLength)
            .IsFixedLength()
            .IsUnicode(false)
            .IsRequired();

        image.Property(item => item.ImageUrl)
            .HasMaxLength(FlashCard.MaxImageUrlLength)
            .IsRequired();
    }

    // Not owned either: a phrase sounds the same for everyone in a given voice, so there's one row for it, shared by
    // every user (0017-*.sql, widened for practice sentences by 0021-*.sql).
    private static void ConfigureCachedAudio(EntityTypeBuilder<CachedAudio> audio)
    {
        // The voice might read "Madrid" and "madrid" differently, so the text is compared case-sensitively.
        audio.HasIndex(item => new { item.Voice, item.SpeakingRate, item.Text })
            .IsUnique();

        audio.Property(item => item.Voice)
            .HasMaxLength(CachedAudio.MaxVoiceLength)
            .IsRequired();

        audio.Property(item => item.SpeakingRate)
            .HasPrecision(3, 2);

        audio.Property(item => item.Text)
            .HasMaxLength(CachedAudio.MaxTextLength)
            .UseCollation("Latin1_General_CS_AS")
            .IsRequired();

        audio.Property(item => item.AudioUrl)
            .HasMaxLength(FlashCard.MaxImageUrlLength)
            .IsRequired();
    }

    // A request's suggestions are made from the user's cards, so a user has one row for each request (0013-*.sql).
    // The suggestions are kept as a JSON array.
    private static void ConfigureCachedSuggestions<TEntity, TItem>(EntityTypeBuilder<TEntity> suggestions)
        where TEntity : class, ICachedSuggestions<TItem>
    {
        // By name, since the type is only known to have them through the interface.
        suggestions.HasIndex(nameof(IUserOwned.UserId), nameof(ICachedSuggestions<TItem>.PromptHash))
            .IsUnique();

        suggestions.Property<string>(nameof(ICachedSuggestions<TItem>.PromptHash))
            .HasMaxLength(SuggestionCache.PromptHashLength)
            .IsFixedLength()
            .IsUnicode(false)
            .IsRequired();
    }

    private static void ConfigureCachedCardSuggestions(EntityTypeBuilder<CachedCardSuggestions> suggestions)
    {
        ConfigureCachedSuggestions<CachedCardSuggestions, CardSuggestion>(suggestions);

        // A card isn't a primitive, so it's converted to JSON here, and compared by its words, so a changed list is
        // saved.
        suggestions.Property(item => item.Suggestions)
            .HasConversion(
                value => JsonSerializer.Serialize(value, JsonSerializerOptions.Web),
                json => JsonSerializer.Deserialize<List<CardSuggestion>>(json, JsonSerializerOptions.Web)
                    ?? new List<CardSuggestion>(),
                new ValueComparer<List<CardSuggestion>>(
                    (left, right) => left!.SequenceEqual(right!),
                    value => value.Aggregate(0, (hash, item) => HashCode.Combine(hash, item)),
                    value => value.ToList()))
            .IsRequired();
    }

    // The OAuth server's tables (0015-*.sql). Codes and tokens are kept as SHA-256 hashes in lowercase hex.
    private static void ConfigureOAuthClient(EntityTypeBuilder<OAuthClient> client)
    {
        client.HasIndex(item => item.ClientId)
            .IsUnique();

        client.Property(item => item.ClientId)
            .HasMaxLength(OAuthClient.MaxClientIdLength)
            .IsRequired();

        client.Property(item => item.Name)
            .HasMaxLength(OAuthClient.MaxNameLength);

        // A list of strings is kept as a JSON array.
        client.Property(item => item.RedirectUris)
            .IsRequired();
    }

    private static void ConfigureOAuthAuthorizationRequest(EntityTypeBuilder<OAuthAuthorizationRequest> request)
    {
        request.Property(item => item.Id)
            .ValueGeneratedNever();

        request.HasOne(item => item.Client)
            .WithMany()
            .HasForeignKey(item => item.OAuthClientId)
            .OnDelete(DeleteBehavior.Cascade);

        request.HasOne<User>()
            .WithMany()
            .HasForeignKey(item => item.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Filtered to the approved requests in the database.
        request.HasIndex(item => item.CodeHash)
            .IsUnique();

        request.Property(item => item.CodeHash)
            .HasMaxLength(OAuth.OAuthTokens.HashLength)
            .IsFixedLength()
            .IsUnicode(false);

        request.Property(item => item.RedirectUri)
            .HasMaxLength(OAuthClient.MaxRedirectUriLength)
            .IsRequired();

        request.Property(item => item.Scope)
            .HasMaxLength(200)
            .IsRequired();

        request.Property(item => item.State)
            .HasMaxLength(OAuthAuthorizationRequest.MaxStateLength);

        request.Property(item => item.CodeChallenge)
            .HasMaxLength(128)
            .IsUnicode(false)
            .IsRequired();

        request.Property(item => item.Resource)
            .HasMaxLength(OAuthClient.MaxRedirectUriLength);
    }

    private static void ConfigureOAuthGrant(EntityTypeBuilder<OAuthGrant> grant)
    {
        grant.HasIndex(item => new { item.UserId, item.OAuthClientId })
            .IsUnique();

        grant.HasOne(item => item.Client)
            .WithMany()
            .HasForeignKey(item => item.OAuthClientId)
            .OnDelete(DeleteBehavior.Cascade);

        grant.Property(item => item.Scope)
            .HasMaxLength(200)
            .IsRequired();
    }

    private static void ConfigureOAuthToken(EntityTypeBuilder<OAuthToken> token)
    {
        token.HasOne<OAuthGrant>()
            .WithMany()
            .HasForeignKey(item => item.GrantId)
            .OnDelete(DeleteBehavior.Cascade);

        token.HasIndex(item => item.TokenHash)
            .IsUnique();

        token.HasIndex(item => item.FamilyId);

        token.Property(item => item.TokenHash)
            .HasMaxLength(OAuth.OAuthTokens.HashLength)
            .IsFixedLength()
            .IsUnicode(false)
            .IsRequired();

        token.Property(item => item.Kind)
            .HasConversion<string>()
            .HasMaxLength(10);
    }
}
