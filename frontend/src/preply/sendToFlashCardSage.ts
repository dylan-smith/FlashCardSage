// The "Send to FlashCardSage" bookmarklet, which the user clicks on their Preply vocabulary page. Preply has no API
// we can call for the user, but its own page reads the vocabulary from its GraphQL API with the user's Preply sign-in,
// and so can a bookmarklet running on that page. It opens FlashCardSage's import page and sends it the words, which
// wordSources/handoff receives.

// One word or phrase from the user's Preply vocabulary. Preply sometimes has no English for a word.
export type PreplyWord = {
  spanish: string
  english: string | null
  partOfSpeech: string | null
}

// What Preply's GraphQL API answers, as far as it's used. It's Preply's internal API, so any of it could be missing.
type VocabularyResponse = {
  errors?: { message?: string }[]
  data?: {
    vocabularyBank?: {
      vocabularyBank?: {
        hasNext?: boolean
        endCursor?: string | null
        nodes?: {
          termDefinition?: {
            spelling?: string
            translation?: { translation?: string } | null
            definition?: {
              translation?: { translation?: string } | null
              lemma?: { typeLabel?: string } | null
            } | null
          } | null
        }[]
      } | null
    } | null
  }
}

// Runs on preply.com, where it's put by bookmarkletHref as its source, so it can't use anything from outside itself,
// not even a constant in this module. The page is a parameter so tests can be somewhere other than preply.com.
export async function sendToFlashCardSage(
  appOrigin: string,
  page: Pick<Location, 'hostname' | 'search'> = window.location,
): Promise<void> {
  if (page.hostname !== 'preply.com') {
    window.alert(
      'Open your vocabulary on preply.com, then click "Send to FlashCardSage" again.',
    )
    return
  }

  // Opened straight away, while the click still lets it, since browsers block windows opened later.
  const app = window.open(`${appOrigin}/import?from=preply`)
  if (app === null) {
    window.alert(
      'Your browser stopped FlashCardSage from opening. Allow pop-ups on preply.com and try again.',
    )
    return
  }

  // The import page says when it's ready for the words.
  const ready = new Promise<void>((resolve) => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin === appOrigin &&
        event.source === app &&
        (event.data as { type?: unknown } | null)?.type ===
          'flashcardsage:ready'
      ) {
        window.removeEventListener('message', onMessage)
        resolve()
      }
    }
    window.addEventListener('message', onMessage)
  })

  let message: unknown
  try {
    const subject = new URLSearchParams(page.search).get('subject') ?? 'spanish'
    const query = `query FlashCardSageVocabulary($after: ID, $subjectAlias: String) {
      vocabularyBank {
        vocabularyBank(category: ADDED, first: 50, after: $after, sortBy: NEXT_PRACTICE_AT, subjectAlias: $subjectAlias) {
          hasNext
          endCursor
          nodes {
            termDefinition {
              spelling
              translation(languageCode: "en") { translation }
              definition {
                translation(languageCode: "en") { translation }
                lemma { typeLabel }
              }
            }
          }
        }
      }
    }`
    const words: PreplyWord[] = []
    let after: string | null = null
    // A page at a time, stopping after far more than anyone has in case Preply keeps saying there's more.
    for (let pages = 0; pages < 100; pages++) {
      const response = await fetch('/graphql/v2/', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { after, subjectAlias: subject },
        }),
      })
      if (!response.ok) {
        throw new Error(`Preply answered with an error (${response.status}).`)
      }
      const body = (await response.json()) as VocabularyResponse
      const bank = body.data?.vocabularyBank?.vocabularyBank
      if (!bank) {
        throw new Error(
          body.errors?.[0]?.message ??
            "Preply didn't send your vocabulary. Check you're signed in to Preply.",
        )
      }
      for (const node of bank.nodes ?? []) {
        const term = node.termDefinition
        if (term?.spelling) {
          words.push({
            spanish: term.spelling,
            english:
              term.definition?.translation?.translation ??
              term.translation?.translation ??
              null,
            partOfSpeech: term.definition?.lemma?.typeLabel ?? null,
          })
        }
      }
      after = bank.hasNext && bank.endCursor ? bank.endCursor : null
      if (after === null) {
        break
      }
    }
    message = { type: 'flashcardsage:preply-words', words }
  } catch (error) {
    message = {
      type: 'flashcardsage:preply-error',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  await ready
  app.postMessage(message, appOrigin)
}

// The bookmark's address, which runs sendToFlashCardSage for this FlashCardSage, wherever it is (production, a PR
// preview or local development).
export function bookmarkletHref(appOrigin: string) {
  const source = `void (${sendToFlashCardSage.toString()})(${JSON.stringify(appOrigin)})`
  return `javascript:${encodeURIComponent(source)}`
}
