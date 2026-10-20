import { describe, expect, it } from 'vitest'
import type { PracticeOutcome } from '../api/flashCards'
import {
  applyAnswer,
  fromStreak,
  scoreAfter,
  streakFromScore,
} from '../practice/score'
import { packCard } from './support/factories'

// The same scores as the API's PracticeScore (see PracticeScoreTests.cs), since the device scores answers before
// they're saved.
describe('the practice score', () => {
  it.each([
    [0, 0],
    [1, 50],
    [2, 80],
    [3, 90],
    [4, 95],
    [5, 100],
    [6, 100],
  ])('scores %i correct answers in a row as %i', (correctInARow, expected) => {
    expect(fromStreak(correctInARow)).toBe(expected)
  })

  it('has no score for a negative run', () => {
    expect(() => fromStreak(-1)).toThrow(RangeError)
  })

  it.each([
    [0, 0],
    [50, 1],
    [80, 2],
    [90, 3],
    [95, 4],
    [100, 5],
    [42, 0],
  ])('takes a score of %i as %i correct answers in a row', (score, streak) => {
    expect(streakFromScore(score)).toBe(streak)
  })

  it.each<[number, PracticeOutcome, number]>([
    [0, 'GotIt', 50],
    [50, 'GotIt', 80],
    [80, 'GotIt', 90],
    [90, 'GotIt', 95],
    [95, 'GotIt', 100],
    [100, 'GotIt', 100],
    [42, 'GotIt', 50],
    [95, 'WasClose', 0],
    [100, 'Failed', 0],
    [0, 'Failed', 0],
  ])('scores %i answered with %s as %i', (score, outcome, expected) => {
    expect(scoreAfter(score, outcome)).toBe(expected)
  })

  it('applies an answer to the card, with when it was given', () => {
    const card = packCard(1, 'el gato', 'the cat', {
      score: 80,
      tagIds: [4],
    })

    expect(applyAnswer(card, 'GotIt', '2026-10-19T10:00:00.000Z')).toEqual({
      ...card,
      score: 90,
      lastPracticedAt: '2026-10-19T10:00:00.000Z',
    })
  })
})
