import { describe, expect, it } from 'vitest'
import type { PackCard } from '../api/practice'
import { pick, weight } from '../practice/picker'
import { packCard } from './support/factories'

// The same picks as the API's PracticePicker made (see PracticePickerTests.cs).
const now = new Date('2026-10-12T12:00:00Z')
const day = 24 * 60 * 60 * 1000

const cat = packCard(1, 'el gato', 'the cat')
const dog = packCard(2, 'el perro', 'the dog')
const house = packCard(3, 'la casa', 'the house')

function daysAgo(days: number) {
  return new Date(now.getTime() - days * day).toISOString()
}

function scored(card: PackCard, score: number, days: number | null = null) {
  return {
    ...card,
    score,
    lastPracticedAt: days === null ? null : daysAgo(days),
  }
}

describe('the practice picker', () => {
  it.each([
    [0, null, 100],
    [90, null, 10],
    [100, 0, 0],
    [100, 7, 7],
    [100, 0.5, 0.5],
    [90, 3, 13],
    [50, 80, 100],
    [100, 150, 100],
  ])(
    'weighs a card with score %i practiced %s days ago as %i',
    (score, days, expected) => {
      expect(weight(scored(cat, score, days), now)).toBeCloseTo(expected, 9)
    },
  )

  it('favours the card with the lower score', () => {
    // Weights 100 and 10, so 0.85 of the way is still the first card, where an even pick would be the second.
    expect(pick([cat, scored(dog, 90)], null, now, 0.85, 0)?.id).toBe(cat.id)
  })

  it.each([
    [0, 1],
    [0.49, 1],
    [0.51, 2],
    [0.99, 2],
  ])('picks in proportion to the weights with a roll of %d', (roll, id) => {
    expect(pick([cat, dog], null, now, roll, 0)?.id).toBe(id)
  })

  it('leaves out a card with the maximum score practiced just now', () => {
    expect(pick([scored(cat, 100, 0), dog], null, now, 0, 0)?.id).toBe(dog.id)
  })

  it.each([
    [50, 1],
    [10, 2],
  ])(
    'gives a card with the maximum score practiced %i days ago more chance the longer it has been',
    (days, id) => {
      // A weight of one for each day, against 50 for the other card.
      const cards = [scored(cat, 100, days), scored(dog, 50)]

      expect(pick(cards, null, now, 0.45, 0)?.id).toBe(id)
    },
  )

  it('leaves out the card just practiced', () => {
    expect(pick([cat, dog, house], cat.id, now, 0, 0)?.id).toBe(dog.id)
  })

  it('keeps the only card', () => {
    expect(pick([scored(cat, 100, 0)], cat.id, now, 0.5, 0)?.id).toBe(cat.id)
  })

  it('picks evenly when no card has any weight', () => {
    const mastered = [scored(cat, 100, 0), scored(dog, 100, 0)]

    expect(pick(mastered, null, now, 0.4, 0)?.id).toBe(cat.id)
    expect(pick(mastered, null, now, 0.6, 0)?.id).toBe(dog.id)
  })

  it.each([
    [0, 'Spanish'],
    [0.49, 'Spanish'],
    [0.5, 'English'],
    [0.99, 'English'],
  ])('shows a side first from a roll of %d: %s', (roll, side) => {
    expect(pick([cat], null, now, 0, roll)).toEqual({
      id: cat.id,
      spanish: ['el gato'],
      english: ['the cat'],
      side,
      imageUrl: null,
    })
  })

  it('keeps the picture', () => {
    const card = { ...cat, imageUrl: 'https://pictures.example/cat.png' }

    expect(pick([card], null, now, 0, 0)?.imageUrl).toBe(card.imageUrl)
  })

  it('picks nothing when there are no cards', () => {
    expect(pick([], null, now, 0, 0)).toBeNull()
  })
})
