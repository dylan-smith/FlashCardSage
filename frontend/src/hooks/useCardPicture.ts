import { useEffect, useRef, useState } from 'react'
import {
  deleteCardImage,
  generateCardImage,
  putCardImage,
  readCardImageFile,
} from '../api/cardImages'
import type { CardImage } from '../api/cardImages'
import { describeFetchError } from '../api/client'
import type { FlashCard } from '../api/flashCards'
import type { CardText } from '../api/translations'
import { trackEvent } from '../telemetry'
import { reportFailure } from '../lib/reportFailure'

// The picture a card form offers: the card's own, if it has one, and a new one the API makes on request or the user
// uploads. A new picture goes on the card when it's saved, unless the user discards it first (or the form is
// cleared). Saving the card itself is the form's job; apply puts the user's choice on the saved card.
//
// current is the picture the card has now (null for a new card), so the form can show it and take it off.
export function useCardPicture(current: string | null) {
  // The new picture, until it's put on the card or discarded, and whether the user uploaded it (or the API made it).
  const [chosen, setChosen] = useState<CardImage | null>(null)
  const [uploaded, setUploaded] = useState(false)
  // Whether the user asked for the card's own picture to be taken off.
  const [removed, setRemoved] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const request = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      request.current?.abort()
    },
    [],
  )

  // Stops a picture that's on its way, e.g. because the card is being saved without it.
  function cancel() {
    request.current?.abort()
    request.current = null
    setGenerating(false)
  }

  // Asks the API for a picture of the card's words, from whichever sides are filled in.
  async function generate(fields: CardText) {
    cancel()
    const controller = new AbortController()
    request.current = controller
    setGenerating(true)
    setErrorMessage('')
    try {
      const image = await generateCardImage(
        fields.spanish.trim(),
        fields.english.trim(),
        controller.signal,
      )
      if (!controller.signal.aborted) {
        setChosen(image)
        setUploaded(false)
        trackEvent('FlashCardImageGenerated')
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        // A 503 or 422 is the API saying why, not a failure to report.
        reportFailure(error, 'generateImage')
        setErrorMessage(describeFetchError(error, 'Unable to make a picture.'))
      }
    } finally {
      if (request.current === controller) {
        request.current = null
        setGenerating(false)
      }
    }
  }

  // Takes a picture the user picked from their device, in place of one that's on its way. A file the API wouldn't
  // take (too big, or not a JPEG, PNG or WebP) is turned away with a message saying why.
  async function upload(file: File) {
    cancel()
    setErrorMessage('')
    try {
      const image = await readCardImageFile(file)
      setChosen(image)
      setUploaded(true)
      trackEvent('FlashCardImageUploaded')
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Unable to read the picture.',
      )
    }
  }

  // Throws the new picture away.
  function discard() {
    cancel()
    setChosen(null)
    setUploaded(false)
    setErrorMessage('')
  }

  // Takes the card's own picture off (when the card is saved), along with any new one.
  function remove() {
    discard()
    setRemoved(true)
  }

  // Forgets everything, for a form that's been cleared or closed.
  function reset() {
    discard()
    setRemoved(false)
  }

  // Puts the user's choice on the saved card: the new picture unless they discarded it, or none when they took the
  // card's off. Returns the card as the API returns it, or null when there was nothing to do.
  async function apply(id: number): Promise<FlashCard | null> {
    if (chosen !== null) {
      const card = await putCardImage(id, chosen)
      trackEvent('FlashCardImageAdded')
      return card
    }
    if (removed && current !== null) {
      const card = await deleteCardImage(id)
      trackEvent('FlashCardImageRemoved')
      return card
    }
    return null
  }

  return {
    // The card's own picture, as the form should show it: none once the user has taken it off.
    current: removed ? null : current,
    chosen,
    uploaded,
    generating,
    errorMessage,
    generate,
    upload,
    discard,
    remove,
    reset,
    cancel,
    apply,
  }
}

export type CardPicture = ReturnType<typeof useCardPicture>
