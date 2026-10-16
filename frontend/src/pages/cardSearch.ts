// Lower case and without accents, so "como" finds "¿cómo estás?".
function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

// Whether any of a card's words has the search text in it, as a card list's search box finds them. Every card
// matches an empty search.
export function matchesSearch(
  card: { spanish: string[]; english: string[] },
  search: string,
) {
  const query = normalize(search.trim())
  return (
    query === '' ||
    card.spanish.some((word) => normalize(word).includes(query)) ||
    card.english.some((word) => normalize(word).includes(query))
  )
}
