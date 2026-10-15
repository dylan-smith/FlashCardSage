// What deleting cards loses, said wherever cards are deleted.
export function cardDeleteWarning(count: number) {
  return count === 1
    ? "This can't be undone. All of the card's scores and its picture will be lost, and it'll be taken out of every deck and tag it's in."
    : "This can't be undone. All of the cards' scores and pictures will be lost, and they'll be taken out of every deck and tag they're in."
}
