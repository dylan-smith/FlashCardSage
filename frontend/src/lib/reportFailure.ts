import { ApiError } from '../api/client'
import { trackException } from '../telemetry'

// Reports a failure, unless it's an error the API sent for the user to see, such as a 409 for a card the user already
// has, which is theirs to fix, not a failure.
export function reportFailure(error: unknown, operation: string) {
  if (!(error instanceof ApiError)) {
    trackException(error, { operation })
  }
}
