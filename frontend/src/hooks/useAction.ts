import { useState } from 'react'
import { describeFetchError } from '../api/client'
import { reportFailure } from '../lib/reportFailure'
import { trackException } from '../telemetry'

export type ActionOptions<K> = {
  // Reported with a failure.
  operation: string
  // The message for a failure that isn't the API's to explain.
  fallback: string
  // What the action is on, such as the card being deleted, so only its buttons wait for the API.
  key?: K
  // Reports every failure, even one the API explained, as deleting does.
  reportAll?: boolean
  // Stays busy once it's done, for an action that goes to another page, so its button doesn't come back first.
  keepBusy?: boolean
  // Gets the message for a failure in place of setErrorMessage.
  onError?: (message: string) => void
}

// Something the user does that the API saves, such as adding or deleting a card. run clears the error, waits for the
// action and, if it fails, reports the failure (unless it's the API's to explain, such as a 409 for a card the user
// already has, which is theirs to fix) and shows why with setErrorMessage. It resolves to whether it worked.
export function useAction<K = undefined>(
  setErrorMessage: (message: string) => void,
) {
  // What's running, or null when nothing is.
  const [running, setRunning] = useState<{ key: K | undefined } | null>(null)

  async function run(options: ActionOptions<K>, action: () => Promise<void>) {
    setRunning({ key: options.key })
    setErrorMessage('')
    try {
      await action()
      if (!options.keepBusy) {
        setRunning(null)
      }
      return true
    } catch (error) {
      if (options.reportAll) {
        trackException(error, { operation: options.operation })
      } else {
        reportFailure(error, options.operation)
      }
      const showError = options.onError ?? setErrorMessage
      showError(describeFetchError(error, options.fallback))
      setRunning(null)
      return false
    }
  }

  return {
    busy: running !== null,
    // The key of the action that's running, if it has one.
    busyKey: running?.key,
    run,
  }
}
