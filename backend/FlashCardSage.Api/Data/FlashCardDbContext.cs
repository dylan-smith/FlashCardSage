using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

/// <remarks>
/// Flash cards belong to a user. A query filter only shows the current user's, and new ones are given the current
/// user when they're saved, so the controllers never handle the owner themselves. Tags and decks work the same way.
/// Practice results are filtered through their card, so they're only the current user's too, and a card's tags are
/// only reached through the card. A deck only gets cards that were found through the filter.
/// </remarks>
public class FlashCardDbContext(DbContextOptions<FlashCardDbContext> options, CurrentUser currentUser) : DbContext(options)
{
    // Read by the query filter each time a query runs, so it's this request's user.
    private int? CurrentUserId => currentUser.UserId;

    public DbSet<User> Users => Set<User>();

    public DbSet<FlashCard> FlashCards => Set<FlashCard>();

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

    private void AssignOwner()
    {
        foreach (var entry in ChangeTracker.Entries<FlashCard>().Where(entry => entry.State == EntityState.Added))
        {
            entry.Entity.UserId = CurrentUserId
                ?? throw new InvalidOperationException("Flash cards can only be saved for a signed-in user.");
        }

        foreach (var entry in ChangeTracker.Entries<Tag>().Where(entry => entry.State == EntityState.Added))
        {
            entry.Entity.UserId = CurrentUserId
                ?? throw new InvalidOperationException("Tags can only be saved for a signed-in user.");
        }

        foreach (var entry in ChangeTracker.Entries<Deck>().Where(entry => entry.State == EntityState.Added))
        {
            entry.Entity.UserId = CurrentUserId
                ?? throw new InvalidOperationException("Decks can only be saved for a signed-in user.");
        }
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>()
            .HasIndex(user => user.Subject)
            .IsUnique();

        modelBuilder.Entity<User>()
            .Property(user => user.Subject)
            .HasMaxLength(255)
            .IsRequired();

        modelBuilder.Entity<User>()
            .Property(user => user.Email)
            .HasMaxLength(320);

        modelBuilder.Entity<User>()
            .Property(user => user.DisplayName)
            .HasMaxLength(200);

        modelBuilder.Entity<FlashCard>()
            .HasQueryFilter(card => card.UserId == CurrentUserId);

        modelBuilder.Entity<FlashCard>()
            .HasOne<User>()
            .WithMany()
            .HasForeignKey(card => card.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<FlashCard>()
            .HasIndex(card => card.UserId);

        // A user has one card for a word, so neither side can be on two of their cards (0006-*.sql).
        modelBuilder.Entity<FlashCard>()
            .HasIndex(card => new { card.UserId, card.Spanish })
            .IsUnique();

        modelBuilder.Entity<FlashCard>()
            .HasIndex(card => new { card.UserId, card.English })
            .IsUnique();

        modelBuilder.Entity<FlashCard>()
            .Property(card => card.Spanish)
            .HasMaxLength(200)
            .IsRequired();

        modelBuilder.Entity<FlashCard>()
            .Property(card => card.English)
            .HasMaxLength(200)
            .IsRequired();

        modelBuilder.Entity<FlashCard>()
            .Property(card => card.ImageUrl)
            .HasMaxLength(FlashCard.MaxImageUrlLength);

        modelBuilder.Entity<PracticeResult>()
            .HasQueryFilter(result => result.FlashCard.UserId == CurrentUserId);

        modelBuilder.Entity<PracticeResult>()
            .HasOne(result => result.FlashCard)
            .WithMany()
            .HasForeignKey(result => result.FlashCardId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<PracticeResult>()
            .HasIndex(result => result.FlashCardId);

        modelBuilder.Entity<PracticeResult>()
            .Property(result => result.Outcome)
            .HasConversion<string>()
            .HasMaxLength(20);

        modelBuilder.Entity<Tag>()
            .HasQueryFilter(tag => tag.UserId == CurrentUserId);

        modelBuilder.Entity<Tag>()
            .HasOne<User>()
            .WithMany()
            .HasForeignKey(tag => tag.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Tag>()
            .HasIndex(tag => new { tag.UserId, tag.Name })
            .IsUnique();

        modelBuilder.Entity<Tag>()
            .Property(tag => tag.Name)
            .HasMaxLength(Tag.MaxNameLength)
            .IsRequired();

        // The database only cascades from the card (see 0005-CreateTagsTables.sql), so EF deletes a tag's links,
        // which needs the tag's cards loaded when it's removed.
        modelBuilder.Entity<FlashCard>()
            .HasMany(card => card.Tags)
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

        modelBuilder.Entity<Deck>()
            .HasQueryFilter(deck => deck.UserId == CurrentUserId);

        modelBuilder.Entity<Deck>()
            .HasOne<User>()
            .WithMany()
            .HasForeignKey(deck => deck.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        modelBuilder.Entity<Deck>()
            .HasIndex(deck => new { deck.UserId, deck.Name })
            .IsUnique();

        modelBuilder.Entity<Deck>()
            .Property(deck => deck.Name)
            .HasMaxLength(Deck.MaxNameLength)
            .IsRequired();

        // Like a tag's links, the database only cascades from the card (see 0007-CreateDecksTables.sql), so EF
        // deletes a deck's links, which needs the deck's cards loaded when it's removed.
        modelBuilder.Entity<Deck>()
            .HasMany(deck => deck.FlashCards)
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
