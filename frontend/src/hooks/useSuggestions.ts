import { useEffect, useEffectEvent, useState } from 'react'
import type { DependencyList } from 'react'
import { trackException } from '../telemetry'

// How many of the suggestions a section has already shown, the newest, it sends to be left out, like the API's
// ShownSuggestions.MaxCount, which keeps the URL short.
export const maxShownSuggestions = 50

export type SuggestionsState<T> =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | { status: 'ready'; suggestions: T[] }

// A handful of suggestions, loaded when a component mounts, again whenever the deps change, and again when refresh asks
// for more. fetch resolves to null when suggestions aren't available, and a failure is reported with operation. A
// result that comes after the deps changed, more were asked for or the component unmounted is ignored, and the signal
// passed to fetch is aborted then too. update changes the suggestions once they're ready, such as to take out one
// that was added.
export function useSuggestions<T>(
  fetch: (signal: AbortSignal) => Promise<T[] | null>,
  deps: DependencyList,
  operation: string,
) {
  const [state, setState] = useState<SuggestionsState<T>>({
    status: 'loading',
  })
  // Bumped to ask for a fresh handful.
  const [request, setRequest] = useState(0)

  const start = useEffectEvent((signal: AbortSignal) => {
    fetch(signal)
      .then((suggestions) => {
        if (!signal.aborted) {
          setState(
            suggestions === null
              ? { status: 'unavailable' }
              : { status: 'ready', suggestions },
          )
        }
      })
      .catch((error: unknown) => {
        if (!signal.aborted) {
          trackException(error, { operation })
          setState({ status: 'failed' })
        }
      })
  })

  useEffect(() => {
    const controller = new AbortController()
    start(controller.signal)
    return () => controller.abort()
    // The deps are the caller's, and fetch is read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, request])

  function refresh() {
    setState({ status: 'loading' })
    setRequest((current) => current + 1)
  }

  function update(change: (suggestions: T[]) => T[]) {
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', suggestions: change(current.suggestions) }
        : current,
    )
  }

  return { state, refresh, update }
}
