using FlashCardSage.Api.Authentication;
using FlashCardSage.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace FlashCardSage.Api.Data;

/// <remarks>
/// Flash cards belong to a user. A query filter only shows the current user's, and new ones are given the current
/// user when they're saved, so the controllers never handle the owner themselves.
/// </remarks>
public class FlashCardDbContext(DbContextOptions<FlashCardDbContext> options, CurrentUser currentUser) : DbContext(options)
{
    // Read by the query filter each time a query runs, so it's this request's user.
    private int? CurrentUserId => currentUser.UserId;

    public DbSet<User> Users => Set<User>();

    public DbSet<FlashCard> FlashCards => Set<FlashCard>();

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

        modelBuilder.Entity<FlashCard>()
            .Property(card => card.Title)
            .HasMaxLength(200)
            .IsRequired();
    }
}
