import type { FlashCardWords } from '../api/flashCards'

// Lower case and without accents, so "como" finds "¿cómo estás?".
function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

// Whether a card's Spanish or English has the search in it, whatever their accents and case. An empty search matches
// every card.
export function matchesSearch(card: FlashCardWords, search: string) {
  const query = normalize(search.trim())
  return (
    query === '' ||
    card.spanish.some((word) => normalize(word).includes(query)) ||
    card.english.some((word) => normalize(word).includes(query))
  )
}
