import { describe, expect, it } from 'vitest'
import { cardCount, skippedSentence } from '../lib/cardCount'

describe('cardCount', () => {
  it('says how many cards there are', () => {
    expect(cardCount(1)).toBe('1 card')
    expect(cardCount(3)).toBe('3 cards')
  })
})

describe('skippedSentence', () => {
  it('says one card was left out', () => {
    expect(skippedSentence(1)).toBe(
      '1 card was left out because you already have it.',
    )
  })

  it('says several cards were left out', () => {
    expect(skippedSentence(3)).toBe(
      '3 cards were left out because you already have them.',
    )
  })
})
