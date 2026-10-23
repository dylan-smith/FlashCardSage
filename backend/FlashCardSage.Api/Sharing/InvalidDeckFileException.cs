namespace FlashCardSage.Api.Sharing;

// Thrown for an uploaded deck file that can't be imported, with what's wrong in words for the user.
public class InvalidDeckFileException : Exception
{
    public InvalidDeckFileException()
    {
    }

    public InvalidDeckFileException(string message) : base(message)
    {
    }

    public InvalidDeckFileException(string message, Exception innerException) : base(message, innerException)
    {
    }
}
