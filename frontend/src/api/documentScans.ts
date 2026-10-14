import { apiBaseUrl } from '../config'
import { apiFetch } from './client'
import type { CardSuggestion } from './cardSuggestions'
import { ApiError, throwIfNotSaved } from './flashCards'

// The most cards a scan makes, the same as the API's limit. A document with more can be scanned again once they're
// added, since a scan leaves out the user's cards.
export const maxDocumentCandidates = 100

// The biggest document the API takes, in bytes.
export const maxDocumentBytes = 10 * 1024 * 1024

// The kinds of documents the API can read, for the file picker.
export const documentTypes = '.txt,.md,.srt,.vtt,.docx'

// The cards made for the words and phrases in a document, for the user to look over before adding them. truncated is
// true when the document was too long to scan all of it, so only its start was scanned.
export type DocumentScan = {
  candidates: CardSuggestion[]
  truncated: boolean
}

// Scans the document for words and phrases to make cards for, or returns null when scanning isn't available (a 503,
// e.g. locally, where there's no Foundry endpoint and key). A document the API can't scan throws an ApiError that says
// why.
export async function scanDocument(file: File): Promise<DocumentScan | null> {
  if (file.size > maxDocumentBytes) {
    throw new ApiError(413, 'Choose a document under 10 MB.')
  }
  const body = new FormData()
  body.append('file', file)
  const response = await apiFetch(`${apiBaseUrl}/api/document-scans`, {
    method: 'POST',
    body,
  })
  if (response.status === 503) {
    return null
  }
  await throwIfNotSaved(response, 'Unable to scan the document.')
  return (await response.json()) as DocumentScan
}
