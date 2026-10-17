// How many cards there are, in words, such as "1 card" or "3 cards".
export function cardCount(count: number) {
  return count === 1 ? '1 card' : `${count} cards`
}
