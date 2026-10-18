// Everything the app keeps in the browser's storage, each under the app's name so it can't clash with anything else
// on the same origin.
export const storageKeys = {
  // localStorage, so a sign-in lasts across reloads and tabs. The E2E, smoke and load tests write it directly to start
  // signed in.
  session: 'flashcardsage.session',
  // localStorage, so a suggestions section stays collapsed across reloads once the user collapses it.
  suggestionsCollapsed: 'flashcardsage.suggestionsCollapsed',
  tagSuggestionsCollapsed: 'flashcardsage.tagSuggestionsCollapsed',
  // sessionStorage, kept for the tab, so the words the Preply bookmarklet sent are still here after the user signs in
  // or reloads the page.
  preplyHandoff: 'flashcardsage.preplyHandoff',
}
