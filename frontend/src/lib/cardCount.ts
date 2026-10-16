// How many cards there are, in words, such as "1 card" or "3 cards".
export function cardCount(count: number) {
  return count === 1 ? '1 card' : `${count} cards`
}

// Says how many cards were left out of those added because the user already had them, such as "3 cards were left out
// because you already have them."
export function skippedSentence(count: number) {
  return `${count === 1 ? '1 card was' : `${count} cards were`} left out because you already have ${count === 1 ? 'it' : 'them'}.`
}
