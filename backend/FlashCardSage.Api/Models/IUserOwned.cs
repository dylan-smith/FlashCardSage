namespace FlashCardSage.Api.Models;

// A row that belongs to a user. FlashCardDbContext only finds the current user's, and gives new ones the current user
// when they're saved.
public interface IUserOwned
{
    int UserId { get; set; }
}
