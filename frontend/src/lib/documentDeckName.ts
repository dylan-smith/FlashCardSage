import { deckNameMaxLength } from '../api/decks'

// The deck a document's cards go in: its name without the extension, such as "Lección 3" for "Lección 3.docx", cut to
// the longest a deck name can be.
export function documentDeckName(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  const name =
    (dot > 0 ? fileName.slice(0, dot) : fileName).trim() || fileName.trim()
  return name.slice(0, deckNameMaxLength).trim()
}
