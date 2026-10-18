using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace FlashCardSage.Api.Data;

/// <remarks>
/// Flash cards belong to a user. A query filter only shows the current user's, and new ones are given the current
/// user when they're saved, so the controllers never handle the owner themselves. Tags and decks work the same way.
/// Practice results and a card's words are filtered through their card, so they're only the current user's too, and
/// a card's tags are only reached through the card. A deck only gets cards that were found through the filter. The
/// built-in decks belong to the system user (see SystemDeckSeeder), and only SystemDecksController reads them past
/// the filter.
/// </remarks>
public class FlashCardDbContext(DbContextOptions<FlashCardDbContext> options, CurrentUser currentUser) : DbContext(options)
{
    // Read by the query filter each time a query runs, so it's this request's user.
    private int? CurrentUserId => currentUser.UserId;

    public DbSet<User> Users => Set<User>();

    public DbSet<FlashCard> FlashCards => Set<FlashCard>();

    public DbSet<FlashCardWord> FlashCardWords => Set<FlashCardWord>();

    public DbSet<PracticeResult> PracticeResults => Set<PracticeResult>();

    public DbSet<Tag> Tags => Set<Tag>();

    public DbSet<Deck> Decks => Set<Deck>();

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        AssignOwner();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        AssignOwner();
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

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureUser(modelBuilder.Entity<User>());
        ConfigureFlashCard(OwnedBy<FlashCard>(modelBuilder));
        ConfigureFlashCardWord(modelBuilder.Entity<FlashCardWord>());
        ConfigurePracticeResult(modelBuilder.Entity<PracticeResult>());
        ConfigureTag(OwnedBy<Tag>(modelBuilder));
        ConfigureDeck(OwnedBy<Deck>(modelBuilder));
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
}
