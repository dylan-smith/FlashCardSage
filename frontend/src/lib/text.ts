// Whether two words or names are the same apart from case, as the API matches them ("Gato" and "gato" are, "si" and
// "sí" aren't).
export function sameText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0
}

// Orders names whatever their case or accents, as the API sends them.
export function compareNames(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

// Orders things such as tags and decks by name, for sort.
export function byName(a: { name: string }, b: { name: string }) {
  return compareNames(a.name, b.name)
}

// A side's words, trimmed, leaving out blanks.
export function trimWords(words: string[]) {
  return words.map((word) => word.trim()).filter((word) => word !== '')
}
