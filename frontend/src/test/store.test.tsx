import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createStore } from '../lib/store'

describe('createStore', () => {
  it('keeps the value and tells the listeners when it changes', () => {
    const store = createStore(1)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.set(2)

    expect(store.get()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.set(3)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("doesn't tell the listeners when the value is the one already kept", () => {
    const value = { name: 'gato' }
    const store = createStore(value)
    const listener = vi.fn()
    store.subscribe(listener)

    store.set(value)

    expect(listener).not.toHaveBeenCalled()
  })

  it('re-renders a component that uses it', () => {
    const store = createStore('el gato')
    function Word() {
      return <p>{store.use()}</p>
    }
    render(<Word />)

    act(() => store.set('el perro'))

    expect(screen.getByText('el perro')).toBeInTheDocument()
  })
})
