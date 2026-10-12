import { useEffect, useRef, useState } from 'react'
import type { FlashCardFields } from '../api/flashCards'
import { translate } from '../api/translations'
import type { CardSide } from '../api/translations'

// How long the user has to stop typing before their side is translated, so each keystroke doesn't send a request.
export const translateDelayMs = 1000

// The most a side of a card can hold, the same as the API's limit.
const maxLength = 200

function otherSide(side: CardSide): CardSide {
  return side === 'spanish' ? 'english' : 'spanish'
}

// Fills in the other side of a card with a translation of the side the user is typing in. A side the user has
// typed in themselves is never filled in, so they can override a translation by typing over it. To hand a side
// back to translation, they can clear it, which fills it with a translation of the other side, or use
// retranslate. A side they haven't typed in (such as a saved card's other side) is filled in. When translation
// fails or isn't available, nothing is filled in and the user types both sides.
//
// onChange gets each change to the fields, the user's own and the translations, and must merge it into the
// current fields rather than the ones it was created with.
export function useAutoTranslate(
  fields: FlashCardFields,
  onChange: (change: Partial<FlashCardFields>) => void,
) {
  // The side last filled in by a translation, which is still the translation.
  const [autoSide, setAutoSide] = useState<CardSide | null>(null)
  // The side a translation is being fetched for.
  const [translating, setTranslating] = useState<CardSide | null>(null)
  // The side the user put their own text in while the other side had text it could be a translation of, by typing
  // (over a translation or not) or picking another meaning.
  const [overridden, setOverridden] = useState<CardSide | null>(null)
  // A translated word's meanings, most common first, for the user to pick from. Kept after they pick one, so they
  // can change their mind, until they type again.
  const [meaningsOf, setMeaningsOf] = useState<{
    side: CardSide
    values: string[]
  } | null>(null)
  const autoSideRef = useRef<CardSide | null>(null)
  const typed = useRef<Record<CardSide, boolean>>({
    spanish: false,
    english: false,
  })
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const request = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      request.current?.abort()
    },
    [],
  )

  function setAuto(side: CardSide | null) {
    autoSideRef.current = side
    setAutoSide(side)
  }

  // Stops any translation that's waiting or on its way, e.g. because the card is being saved.
  function cancel() {
    clearTimeout(timer.current)
    request.current?.abort()
    request.current = null
    setTranslating(null)
  }

  // Forgets what the user typed, for a form that's been cleared.
  function reset() {
    cancel()
    typed.current = { spanish: false, english: false }
    setAuto(null)
    setOverridden(null)
    setMeaningsOf(null)
  }

  // Translates text, from side from, into the other side after delay ms.
  function schedule(from: CardSide, text: string, delay: number) {
    const target = otherSide(from)
    timer.current = setTimeout(() => {
      const controller = new AbortController()
      request.current = controller
      setTranslating(target)
      translate(text, from, controller.signal)
        .then(({ translation, alternatives }) => {
          // Any change to the fields aborts the request, so the user hasn't typed since it was sent.
          if (!controller.signal.aborted) {
            onChange({ [target]: translation.slice(0, maxLength) })
            setAuto(target)
            setMeaningsOf(
              alternatives.length > 0
                ? { side: target, values: [translation, ...alternatives] }
                : null,
            )
          }
        })
        .catch(() => {
          // The user types the other side themselves.
        })
        .finally(() => {
          if (request.current === controller) {
            request.current = null
            setTranslating(null)
          }
        })
    }, delay)
  }

  // The user typed value into side.
  function change(side: CardSide, value: string) {
    onChange({ [side]: value })
    cancel()
    setMeaningsOf(null)

    const text = value.trim()
    const target = otherSide(side)
    typed.current[side] = text !== ''
    if (autoSideRef.current === side) {
      setAuto(null)
    }
    if (text === '') {
      setOverridden((current) => (current === side ? null : current))
    } else if (fields[target].trim() !== '') {
      // There's something on the other side it could be a translation of.
      setOverridden(side)
    }

    if (text === '') {
      if (autoSideRef.current === target) {
        // A translation of nothing is nothing.
        onChange({ [target]: '' })
        setAuto(null)
      } else if (fields[target].trim() !== '') {
        // Clearing a side hands it back to translation.
        schedule(target, fields[target].trim(), translateDelayMs)
      }
      return
    }
    if (!typed.current[target]) {
      schedule(side, text, translateDelayMs)
    }
  }

  // Tells the user when a side is being translated or was, so they know to check it.
  function helperText(side: CardSide) {
    if (translating === side) {
      return 'Translating…'
    }
    return autoSide === side ? 'Auto-translated: edit to change' : undefined
  }

  // The meanings of the word translated into side, if it has more than one.
  function meanings(side: CardSide) {
    return meaningsOf?.side === side ? meaningsOf.values : []
  }

  // The user picked one of a word's meanings. It's their choice, so like a side they typed, it isn't translated
  // over.
  function choose(side: CardSide, meaning: string) {
    cancel()
    onChange({ [side]: meaning.slice(0, maxLength) })
    typed.current[side] = true
    setAuto(null)
    setOverridden(side)
  }

  // Whether the user can hand side back to translation: they put their own text in it, and there's something on
  // the other side to translate.
  function canRetranslate(side: CardSide) {
    return (
      overridden === side &&
      translating !== side &&
      fields[otherSide(side)].trim() !== ''
    )
  }

  // Drops the user's override of side and translates the other side into it right away.
  function retranslate(side: CardSide) {
    const from = otherSide(side)
    const text = fields[from].trim()
    if (text === '') {
      return
    }
    cancel()
    typed.current[side] = false
    setOverridden(null)
    setMeaningsOf(null)
    schedule(from, text, 0)
  }

  return {
    change,
    cancel,
    reset,
    helperText,
    meanings,
    choose,
    canRetranslate,
    retranslate,
  }
}

export type AutoTranslate = ReturnType<typeof useAutoTranslate>
