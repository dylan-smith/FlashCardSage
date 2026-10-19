// Everything the app keeps in the browser's storage, each under the app's name so it can't clash with anything else
// on the same origin.
export const storageKeys = {
  // localStorage, so a sign-in lasts across reloads and tabs. The E2E, smoke and load tests write it directly to start
  // signed in.
  session: 'flashcardsage.session',
  // localStorage, so a suggestions section stays collapsed across reloads once the user collapses it.
  suggestionsCollapsed: 'flashcardsage.suggestionsCollapsed',
  tagSuggestionsCollapsed: 'flashcardsage.tagSuggestionsCollapsed',
  // sessionStorage, kept for the tab, so the words a site's bookmarklet sent are still here after the user signs in or
  // reloads the page.
  wordHandoff: 'flashcardsage.wordHandoff',
  // localStorage, one for each user (see userStorageKey), so practice works offline: the user's cards, decks and tags
  // as last loaded, the answers not yet saved to the API, and the preferences as last loaded. None of them are cleared
  // at sign-out, since answers must outlive a sign-out from an expired token until the user is back.
  practicePack: 'flashcardsage.practicePack',
  practiceQueue: 'flashcardsage.practiceQueue',
  preferences: 'flashcardsage.preferences',
}

// The key for what's kept for one user, the subject from sessionSubject, so users of the same browser don't see each
// other's.
export function userStorageKey(key: string, subject: string) {
  return `${key}:${subject}`
}
