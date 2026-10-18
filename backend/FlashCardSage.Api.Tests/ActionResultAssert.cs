using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Tests;

// Asserts on what a controller action returned, as the tests that call controllers directly see it.
internal static class ActionResultAssert
{
    // The value of a 200 OK, which must be a T.
    public static T Ok<T>(IActionResult? result)
    {
        return Assert.IsType<T>(Assert.IsType<OkObjectResult>(result).Value);
    }

    // The value of a 201 Created pointing at another action, which must be a T.
    public static T Created<T>(IActionResult? result)
    {
        return Assert.IsType<T>(Assert.IsType<CreatedAtActionResult>(result).Value);
    }

    // A validation problem whose only message for the field is this one, returned for any further checks.
    public static ValidationProblemDetails ValidationProblem(IActionResult? result, string field, string message)
    {
        var problem = Assert.IsType<ValidationProblemDetails>(Assert.IsType<ObjectResult>(result).Value);
        Assert.Equal([message], problem.Errors[field]);
        return problem;
    }

    // A problem with this status code and, when one is given, this detail.
    public static ObjectResult Problem(IActionResult? result, int statusCode, string? detail = null)
    {
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(statusCode, objectResult.StatusCode);
        if (detail is not null)
        {
            Assert.Equal(detail, Assert.IsType<ProblemDetails>(objectResult.Value).Detail);
        }

        return objectResult;
    }

    // A 409 Conflict problem with this detail.
    public static ObjectResult Conflict(IActionResult? result, string detail)
    {
        return Problem(result, StatusCodes.Status409Conflict, detail);
    }
}
