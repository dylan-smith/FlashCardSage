import { useEffect, useEffectEvent, useState } from 'react'
import type { DependencyList, Dispatch, SetStateAction } from 'react'
import { describeFetchError } from '../api/client'
import { trackException } from '../telemetry'

export type LoadOptions<T> = {
  // Reported with a failure. Without one, a failure isn't reported.
  operation?: string
  // The message for a failure that isn't the API's to explain.
  fallback?: string
  // Gets the message for a failure, for a page that shows it with its actions' errors.
  onError?: (message: string) => void
  // The data until it's loaded.
  initial?: T
  // When false, nothing is loaded, and the data is left as it is.
  enabled?: boolean
}

export type Loaded<T> = {
  data: T
  // Changes the data once it's loaded, such as after a card is added.
  setData: Dispatch<SetStateAction<T>>
  loading: boolean
  // Set when it couldn't be loaded, so a page doesn't claim there's nothing to show.
  failed: boolean
  // Why it couldn't be loaded.
  error: string
  // Loads it again.
  reload: () => void
}

type Status = {
  key: unknown[]
  loading: boolean
  failed: boolean
  error: string
}

function sameKey(a: unknown[], b: unknown[]) {
  return (
    a.length === b.length &&
    a.every((value, index) => Object.is(value, b[index]))
  )
}

// Loads data when a component mounts, and again whenever the deps change. A result that comes after the deps changed
// or the component unmounted is ignored, and the signal passed to load is aborted then too.
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  options: LoadOptions<T> & { initial: T },
): Loaded<T>
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  options?: LoadOptions<T>,
): Loaded<T | undefined>
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
  options: LoadOptions<T> = {},
): Loaded<T | undefined> {
  const { enabled = true } = options
  const [data, setData] = useState<T | undefined>(options.initial)
  const [attempt, setAttempt] = useState(0)
  const key = [...deps, attempt, enabled]
  const [status, setStatus] = useState<Status>({
    key,
    loading: enabled,
    failed: false,
    error: '',
  })
  // It's loading again as soon as the deps change, rather than once the effect runs.
  if (!sameKey(status.key, key)) {
    setStatus({ key, loading: enabled, failed: false, error: '' })
  }

  const start = useEffectEvent((signal: AbortSignal) => {
    const { operation, fallback = '', onError } = options
    load(signal)
      .then((loaded) => {
        if (!signal.aborted) {
          setData(loaded)
          setStatus((current) => ({ ...current, loading: false }))
        }
      })
      .catch((error: unknown) => {
        if (signal.aborted) {
          return
        }
        if (operation !== undefined) {
          trackException(error, { operation })
        }
        const message = describeFetchError(error, fallback)
        setStatus((current) => ({
          ...current,
          loading: false,
          failed: true,
          error: message,
        }))
        onError?.(message)
      })
  })

  useEffect(() => {
    if (!enabled) {
      return
    }
    const controller = new AbortController()
    start(controller.signal)
    return () => controller.abort()
    // The deps are the caller's, and load is read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt, enabled])

  return {
    data,
    setData,
    loading: status.loading,
    failed: status.failed,
    error: status.error,
    reload: () => setAttempt((current) => current + 1),
  }
}
