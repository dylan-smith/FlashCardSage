using Microsoft.AspNetCore.Mvc;

namespace FlashCardSage.Api.Controllers;

// The problem responses the controllers share.
public abstract class ApiControllerBase : ControllerBase
{
    // Whether an upstream service failed: it couldn't be reached or answered with an error, or it timed out, which
    // surfaces as a cancellation the caller didn't ask for. The caller's own cancellation isn't a failure.
    protected static bool IsUpstreamFailure(Exception exception, CancellationToken cancellationToken)
    {
        return exception is HttpRequestException
            || (exception is TaskCanceledException && !cancellationToken.IsCancellationRequested);
    }

    // A 409 that says what clashed with the user's own data.
    protected ObjectResult ConflictProblem(string detail)
    {
        return Problem(detail: detail, statusCode: StatusCodes.Status409Conflict);
    }

    // A 502 for an upstream service that failed (see IsUpstreamFailure).
    protected ObjectResult BadGatewayProblem(string detail)
    {
        return Problem(detail: detail, statusCode: StatusCodes.Status502BadGateway);
    }

    // A 503 for an upstream service that isn't set up, e.g. in local development and E2E tests.
    protected ObjectResult ServiceUnavailableProblem(string detail)
    {
        return Problem(detail: detail, statusCode: StatusCodes.Status503ServiceUnavailable);
    }
}
