import { describe, expect, it } from 'vitest'
import { isAt, modeAt } from '../components/layout/nav'

describe('isAt', () => {
  it('matches the page and the pages under it', () => {
    expect(isAt('/decks', { to: '/decks', label: 'Decks' })).toBe(true)
    expect(isAt('/decks/7', { to: '/decks', label: 'Decks' })).toBe(true)
    expect(isAt('/decksx', { to: '/decks', label: 'Decks' })).toBe(false)
  })

  it('matches / only on itself', () => {
    expect(isAt('/', { to: '/', label: 'Cards' })).toBe(true)
    expect(isAt('/tags', { to: '/', label: 'Cards' })).toBe(false)
  })
})

describe('modeAt', () => {
  it('finds the mode a page is in, through its sections', () => {
    expect(modeAt('/')?.label).toBe('Manage cards')
    expect(modeAt('/decks/7')?.label).toBe('Manage cards')
    expect(modeAt('/practice')?.label).toBe('Practice')
  })

  it('finds none for a page that is in no mode', () => {
    expect(modeAt('/preferences')).toBeUndefined()
    expect(modeAt('/nowhere')).toBeUndefined()
  })
})
