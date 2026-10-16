using System.ComponentModel.DataAnnotations;

namespace FlashCardSage.Api.Contracts;

// Which cards to practice or score, from the query string: a deck's, a tag's, or all of them when neither is given.
public class PracticeSelection : IValidatableObject
{
    public int? DeckId { get; set; }

    public int? TagId { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (DeckId is not null && TagId is not null)
        {
            yield return new ValidationResult(
                "Practice a deck or a tag, not both.", [nameof(DeckId), nameof(TagId)]);
        }
    }
}
