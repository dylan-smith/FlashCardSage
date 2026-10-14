import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FlashCardFields, Tag } from '../api/flashCards'
import { suggestTags } from '../api/tagSuggestions'
import { usePreferences } from './usePreferences'

// How long the user has to stop typing before tags are suggested for the card, so each keystroke doesn't ask the
// model.
export const tagSuggestDelayMs = 1000

function trimWords(words: string[]) {
  return words.map((word) => word.trim()).filter((word) => word !== '')
}

// The names of the user's tags that the card being added or changed goes under, for the user to add with a click.
// They're asked for once the card has words and the user has stopped typing, and only when the user has tags and
// wants suggestions (which cost a request to the model). None when no tag fits, suggestions fail or they aren't
// available, and a tag the user has put on the card isn't suggested.
export function useTagSuggestions(fields: FlashCardFields, tags: Tag[]) {
  const enabled = usePreferences()?.showSuggestions === true
  // The suggestions, with the words they're for, so they disappear as soon as the words change.
  const [suggested, setSuggested] = useState<{
    key: string
    names: string[]
  } | null>(null)
  // Set once the API says suggestions aren't available, so they aren't asked for again.
  const unavailable = useRef(false)
  const spanish = trimWords(fields.spanish)
  const english = trimWords(fields.english)
  const key = JSON.stringify([spanish, english])
  const hasWords = spanish.length > 0 || english.length > 0
  const hasTags = tags.length > 0

  // Reads the card's tags as they are when the suggestions are asked for, so changing them doesn't ask again.
  const request = useEffectEvent((signal: AbortSignal) => {
    suggestTags({ spanish, english, tags: fields.tags }, signal)
      .then((result) => {
        if (result === null) {
          unavailable.current = true
        } else {
          setSuggested({ key, names: result.map((tag) => tag.name) })
        }
      })
      .catch(() => {
        // The user picks the tags themselves.
      })
  })

  useEffect(() => {
    if (!enabled || !hasTags || !hasWords || unavailable.current) {
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(
      () => request(controller.signal),
      tagSuggestDelayMs,
    )
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [key, enabled, hasTags, hasWords])

  const onCard = new Set(fields.tags.map((name) => name.toLowerCase()))
  return suggested?.key === key
    ? suggested.names.filter((name) => !onCard.has(name.toLowerCase()))
    : []
}
