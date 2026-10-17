import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, unreachableMessage } from '../api/client'
import { useAction } from '../hooks/useAction'
import { useConfirm } from '../hooks/useConfirm'
import { useLoad } from '../hooks/useLoad'
import { useSuggestions } from '../hooks/useSuggestions'
import { trackException } from '../telemetry'

vi.mock('../telemetry', () => ({
  trackEvent: vi.fn(),
  trackException: vi.fn(),
  trackPageView: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(trackException).mockClear()
})

describe('useLoad', () => {
  it('loads the data, starting out loading', async () => {
    const { result } = renderHook(() =>
      useLoad(() => Promise.resolve(['gato']), [], { initial: [] as string[] }),
    )

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toEqual([])
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual(['gato'])
    expect(result.current.failed).toBe(false)
  })

  it('reports a failure and says why', async () => {
    const error = new Error('broken')
    const onError = vi.fn()
    const { result } = renderHook(() =>
      useLoad(() => Promise.reject(error), [], {
        operation: 'load',
        fallback: 'Unable to load.',
        onError,
      }),
    )

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('Unable to load.')
    expect(onError).toHaveBeenCalledWith('Unable to load.')
    expect(trackException).toHaveBeenCalledWith(error, { operation: 'load' })
  })

  it("doesn't report a failure without an operation", async () => {
    const { result } = renderHook(() =>
      useLoad(() => Promise.reject(new TypeError('Failed to fetch')), []),
    )

    await waitFor(() => expect(result.current.failed).toBe(true))
    expect(result.current.error).toBe(unreachableMessage)
    expect(trackException).not.toHaveBeenCalled()
  })

  it('loads again when the deps change, ignoring the earlier result', async () => {
    const pending: ((value: string) => void)[] = []
    const signals: AbortSignal[] = []
    const { result, rerender } = renderHook(
      ({ id }: { id: number }) =>
        useLoad(
          (signal) => {
            signals.push(signal)
            return new Promise<string>((resolve) => pending.push(resolve))
          },
          [id],
        ),
      { initialProps: { id: 1 } },
    )
    await waitFor(() => expect(pending).toHaveLength(1))

    rerender({ id: 2 })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(signals[0].aborted).toBe(true)
    await act(async () => {
      pending[0]('first')
      pending[1]('second')
      await Promise.resolve()
    })
    expect(result.current.data).toBe('second')
    expect(result.current.loading).toBe(false)
  })

  it('loads again on reload, keeping the data while it does', async () => {
    let count = 0
    const { result } = renderHook(() =>
      useLoad(() => Promise.resolve(++count), []),
    )
    await waitFor(() => expect(result.current.data).toBe(1))

    act(() => result.current.reload())

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBe(1)
    await waitFor(() => expect(result.current.data).toBe(2))
  })

  it("loads nothing while it isn't enabled, keeping the data", async () => {
    const load = vi.fn(() => Promise.resolve('gato'))
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useLoad(load, [enabled], { initial: null as string | null, enabled }),
      { initialProps: { enabled: false } },
    )
    expect(result.current.loading).toBe(false)
    expect(load).not.toHaveBeenCalled()

    rerender({ enabled: true })
    await waitFor(() => expect(result.current.data).toBe('gato'))
    rerender({ enabled: false })

    expect(result.current.data).toBe('gato')
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('useAction', () => {
  it('clears the error, is busy while it runs and resolves to true', async () => {
    const setErrorMessage = vi.fn()
    const { result } = renderHook(() => useAction<number>(setErrorMessage))
    let finish = () => {}
    let done: Promise<boolean> = Promise.resolve(false)

    act(() => {
      done = result.current.run(
        { operation: 'save', fallback: 'Unable to save.', key: 7 },
        () => new Promise<void>((resolve) => (finish = resolve)),
      )
    })

    expect(setErrorMessage).toHaveBeenCalledWith('')
    expect(result.current.busy).toBe(true)
    expect(result.current.busyKey).toBe(7)
    await act(async () => {
      finish()
      expect(await done).toBe(true)
    })
    expect(result.current.busy).toBe(false)
    expect(result.current.busyKey).toBeUndefined()
  })

  it('shows why it failed and reports it, resolving to false', async () => {
    const setErrorMessage = vi.fn()
    const { result } = renderHook(() => useAction(setErrorMessage))
    const error = new Error('broken')

    let saved = true
    await act(async () => {
      saved = await result.current.run(
        { operation: 'save', fallback: 'Unable to save.' },
        () => Promise.reject(error),
      )
    })

    expect(saved).toBe(false)
    expect(setErrorMessage).toHaveBeenLastCalledWith('Unable to save.')
    expect(trackException).toHaveBeenCalledWith(error, { operation: 'save' })
    expect(result.current.busy).toBe(false)
  })

  it("shows the API's message without reporting it, unless asked to", async () => {
    const setErrorMessage = vi.fn()
    const { result } = renderHook(() => useAction(setErrorMessage))
    const error = new ApiError(409, 'You already have it.')

    await act(async () => {
      await result.current.run(
        { operation: 'save', fallback: 'Unable to save.' },
        () => Promise.reject(error),
      )
    })
    expect(setErrorMessage).toHaveBeenLastCalledWith('You already have it.')
    expect(trackException).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.run(
        { operation: 'delete', fallback: 'Unable to delete.', reportAll: true },
        () => Promise.reject(error),
      )
    })
    expect(trackException).toHaveBeenCalledWith(error, { operation: 'delete' })
  })

  it('gives the message to onError instead, when there is one', async () => {
    const setErrorMessage = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useAction(setErrorMessage))

    await act(async () => {
      await result.current.run(
        { operation: 'save', fallback: 'Unable to save.', onError },
        () => Promise.reject(new Error('broken')),
      )
    })

    expect(onError).toHaveBeenCalledWith('Unable to save.')
    expect(setErrorMessage).not.toHaveBeenCalledWith('Unable to save.')
  })

  it('stays busy once it worked, when asked to', async () => {
    const { result } = renderHook(() => useAction(vi.fn()))

    await act(async () => {
      await result.current.run(
        { operation: 'create', fallback: 'Unable to save.', keepBusy: true },
        () => Promise.resolve(),
      )
    })

    expect(result.current.busy).toBe(true)
  })
})

describe('useConfirm', () => {
  it('opens on what was asked about, and keeps it once closed', () => {
    const { result } = renderHook(() => useConfirm<string>())
    expect(result.current.target).toBeNull()
    expect(result.current.dialogProps.open).toBe(false)

    act(() => result.current.ask('el gato'))

    expect(result.current.target).toBe('el gato')
    expect(result.current.dialogProps.open).toBe(true)

    act(() => result.current.dialogProps.onCancel())

    expect(result.current.dialogProps.open).toBe(false)
    expect(result.current.target).toBe('el gato')
  })
})

describe('useSuggestions', () => {
  it('loads the suggestions, starting out loading', async () => {
    const { result } = renderHook(() =>
      useSuggestions(() => Promise.resolve(['gato']), [], 'suggest'),
    )

    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'ready',
        suggestions: ['gato'],
      }),
    )
  })

  it("says when suggestions aren't available", async () => {
    const { result } = renderHook(() =>
      useSuggestions(() => Promise.resolve(null), [], 'suggest'),
    )

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'unavailable' }),
    )
    expect(trackException).not.toHaveBeenCalled()
  })

  it('reports a failure with the operation', async () => {
    const error = new Error('broken')
    const { result } = renderHook(() =>
      useSuggestions(() => Promise.reject(error), [], 'suggestTags'),
    )

    await waitFor(() =>
      expect(result.current.state).toEqual({ status: 'failed' }),
    )
    expect(trackException).toHaveBeenCalledWith(error, {
      operation: 'suggestTags',
    })
  })

  it('asks for more on refresh, ignoring the earlier request', async () => {
    const pending: ((value: string[]) => void)[] = []
    const signals: AbortSignal[] = []
    const { result } = renderHook(() =>
      useSuggestions(
        (signal) => {
          signals.push(signal)
          return new Promise<string[]>((resolve) => pending.push(resolve))
        },
        [],
        'suggest',
      ),
    )
    await waitFor(() => expect(pending).toHaveLength(1))

    act(() => result.current.refresh())

    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() => expect(pending).toHaveLength(2))
    expect(signals[0].aborted).toBe(true)
    await act(async () => {
      pending[0](['viejo'])
      await Promise.resolve()
    })
    expect(result.current.state).toEqual({ status: 'loading' })
    act(() => pending[1](['nuevo']))
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: 'ready',
        suggestions: ['nuevo'],
      }),
    )
  })

  it('changes the suggestions once they are ready', async () => {
    const { result } = renderHook(() =>
      useSuggestions(() => Promise.resolve(['gato', 'perro']), [], 'suggest'),
    )
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    act(() =>
      result.current.update((current) =>
        current.filter((name) => name !== 'gato'),
      ),
    )

    expect(result.current.state).toEqual({
      status: 'ready',
      suggestions: ['perro'],
    })
  })
})
