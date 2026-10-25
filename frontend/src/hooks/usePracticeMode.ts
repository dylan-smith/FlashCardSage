import { useState } from 'react'
import { readJson, writeJson } from '../lib/localJson'
import { storageKeys } from '../lib/storageKeys'
import { trackEvent } from '../telemetry'

// What practice shows: the cards themselves, or sentences written from them.
export type PracticeMode = 'cards' | 'sentences'

function isPracticeMode(value: unknown): value is PracticeMode {
  return value === 'cards' || value === 'sentences'
}

// Which mode practice is in, cards unless the user picked sentences. Remembered in the browser, so it stays as it is
// across reloads.
export function usePracticeMode() {
  const [mode, setMode] = useState<PracticeMode>(
    () => readJson(storageKeys.practiceMode, isPracticeMode) ?? 'cards',
  )
  function change(value: PracticeMode) {
    setMode(value)
    writeJson(storageKeys.practiceMode, value)
    trackEvent('PracticeModeChanged', { mode: value })
  }
  return [mode, change] as const
}
