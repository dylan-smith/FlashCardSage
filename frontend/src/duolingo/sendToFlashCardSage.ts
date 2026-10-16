// The "Send to FlashCardSage" bookmarklet for Duolingo, which the user clicks on their Duolingo word list
// (duolingo.com/practice-hub/words). Duolingo has no API we can call for the user, but its own page reads the words
// from Duolingo's API with the user's sign-in (the jwt_token cookie), and so can a bookmarklet running on that page. It
// opens FlashCardSage's import page and sends it the words, which wordSources/handoff receives.

// One word or phrase from the user's Duolingo word list, with every English meaning Duolingo gives it.
export type DuolingoWord = {
  spanish: string
  english: string[]
}

// What Duolingo's API answers, as far as it's used. It's Duolingo's internal API, so any of it could be missing.
type CourseResponse = {
  currentCourse?: {
    learningLanguage?: string
    fromLanguage?: string
    pathSectioned?: {
      units?: {
        levels?: {
          state?: string
          finishedSessions?: number
          pathLevelMetadata?: { skillId?: string } | null
        }[]
      }[]
    }[]
  } | null
}

type LexemesResponse = {
  learnedLexemes?: { text?: string; translations?: unknown[] }[]
  pagination?: { nextStartIndex?: number | null } | null
}

// Runs on www.duolingo.com, where it's put by duolingoBookmarkletHref as its source, so it can't use anything from
// outside itself, not even a constant in this module. The page is a parameter so tests can be somewhere other than
// duolingo.com.
export async function sendDuolingoToFlashCardSage(
  appOrigin: string,
  page: Pick<Location, 'hostname'> = window.location,
): Promise<void> {
  if (page.hostname !== 'www.duolingo.com') {
    window.alert(
      'Open your word list on duolingo.com, then click "Send to FlashCardSage" again.',
    )
    return
  }

  // Opened straight away, while the click still lets it, since browsers block windows opened later.
  const app = window.open(`${appOrigin}/import?from=duolingo`)
  if (app === null) {
    window.alert(
      'Your browser stopped FlashCardSage from opening. Allow pop-ups on duolingo.com and try again.',
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
    // Duolingo's page sends its sign-in token, from a cookie, with every request. The user's id is in the token.
    const token = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('jwt_token='))
      ?.slice('jwt_token='.length)
    if (!token) {
      throw new Error(
        "You're not signed in to Duolingo. Sign in, then click the bookmarklet again.",
      )
    }
    const claims = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { sub?: unknown }
    const userId = claims.sub
    if (typeof userId !== 'number' && typeof userId !== 'string') {
      throw new Error("Duolingo's sign-in couldn't be read.")
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }

    // The words are the course's, and which of them the user has learned comes from how far along it they are, as
    // Duolingo's own page works it out: the first level of each skill, unless it's still locked.
    const userResponse = await fetch(
      `/2017-06-30/users/${userId}?fields=currentCourse`,
      { headers },
    )
    if (!userResponse.ok) {
      throw new Error(
        `Duolingo answered with an error (${userResponse.status}).`,
      )
    }
    const course = ((await userResponse.json()) as CourseResponse).currentCourse
    if (!course?.learningLanguage || !course.fromLanguage) {
      throw new Error(
        "Duolingo didn't send your course. Check you're signed in to Duolingo.",
      )
    }
    if (course.learningLanguage !== 'es' || course.fromLanguage !== 'en') {
      throw new Error(
        'FlashCardSage is for learning Spanish from English. Switch to that course on Duolingo, then click the bookmarklet again.',
      )
    }
    const progressedSkills: {
      finishedLevels: number
      finishedSessions: number
      skillId: { id: string }
    }[] = []
    const skillsSeen = new Set<string>()
    for (const section of course.pathSectioned ?? []) {
      for (const unit of section.units ?? []) {
        for (const level of unit.levels ?? []) {
          const id = level.pathLevelMetadata?.skillId
          if (!id || skillsSeen.has(id)) {
            continue
          }
          skillsSeen.add(id)
          if (level.state !== 'locked') {
            progressedSkills.push({
              finishedLevels:
                level.state === 'passed' || level.state === 'legendary' ? 1 : 0,
              finishedSessions: level.finishedSessions ?? 0,
              skillId: { id },
            })
          }
        }
      }
    }

    const words: DuolingoWord[] = []
    let start: number | null = 0
    // A page at a time, stopping after far more than anyone has in case Duolingo keeps saying there's more.
    for (let pages = 0; pages < 100 && start !== null; pages++) {
      const response = await fetch(
        `/2017-06-30/users/${userId}/courses/${course.learningLanguage}/${course.fromLanguage}/learned-lexemes?limit=500&sortBy=ALPHABETICAL&startIndex=${start}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ lastTotalLexemeCount: 0, progressedSkills }),
        },
      )
      if (!response.ok) {
        throw new Error(`Duolingo answered with an error (${response.status}).`)
      }
      const body = (await response.json()) as LexemesResponse
      if (!body.learnedLexemes) {
        throw new Error("Duolingo didn't send your words.")
      }
      for (const lexeme of body.learnedLexemes) {
        if (lexeme.text) {
          words.push({
            spanish: lexeme.text,
            english: (lexeme.translations ?? []).filter(
              (translation): translation is string =>
                typeof translation === 'string',
            ),
          })
        }
      }
      const next = body.pagination?.nextStartIndex
      start = typeof next === 'number' ? next : null
    }
    message = { type: 'flashcardsage:duolingo-words', words }
  } catch (error) {
    message = {
      type: 'flashcardsage:duolingo-error',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  await ready
  app.postMessage(message, appOrigin)
}

// The bookmark's address, which runs sendDuolingoToFlashCardSage for this FlashCardSage, wherever it is (production, a
// PR preview or local development).
export function duolingoBookmarkletHref(appOrigin: string) {
  const source = `void (${sendDuolingoToFlashCardSage.toString()})(${JSON.stringify(appOrigin)})`
  return `javascript:${encodeURIComponent(source)}`
}
