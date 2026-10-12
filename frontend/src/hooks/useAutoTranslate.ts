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
// typed in themselves is never filled in, so they can override a translation by typing over it, and clearing it
// lets translation fill it again. A side they haven't typed in (such as a saved card's other side) is filled in.
// When translation fails or isn't available, nothing is filled in and the user types both sides.
//
// onChange gets each change to the fields, the user's own and the translations, and must merge it into the
// current fields rather than the ones it was created with.
export function useAutoTranslate(
  onChange: (change: Partial<FlashCardFields>) => void,
) {
  // The side last filled in by a translation, which is still the translation.
  const [autoSide, setAutoSide] = useState<CardSide | null>(null)
  // The side a translation is being fetched for.
  const [translating, setTranslating] = useState<CardSide | null>(null)
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
  }

  // The user typed value into side.
  function change(side: CardSide, value: string) {
    onChange({ [side]: value })
    cancel()

    const text = value.trim()
    typed.current[side] = text !== ''
    if (autoSideRef.current === side) {
      setAuto(null)
    }

    const target = otherSide(side)
    if (typed.current[target]) {
      return
    }
    if (text === '') {
      // A translation of nothing is nothing.
      if (autoSideRef.current === target) {
        onChange({ [target]: '' })
        setAuto(null)
      }
      return
    }

    timer.current = setTimeout(() => {
      const controller = new AbortController()
      request.current = controller
      setTranslating(target)
      translate(text, side, controller.signal)
        .then((translation) => {
          // Any change to the fields aborts the request, so the user hasn't typed since it was sent.
          if (!controller.signal.aborted) {
            onChange({ [target]: translation.slice(0, maxLength) })
            setAuto(target)
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
    }, translateDelayMs)
  }

  // Tells the user when a side is being translated or was, so they know to check it.
  function helperText(side: CardSide) {
    if (translating === side) {
      return 'Translating…'
    }
    return autoSide === side ? 'Auto-translated: edit to change' : undefined
  }

  return { change, cancel, reset, helperText }
}
