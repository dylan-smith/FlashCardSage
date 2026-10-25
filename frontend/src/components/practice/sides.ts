import type { PracticeSide } from '../../api/flashCards'

// Which field of a card holds each side, and its language.
export const sides: Record<
  PracticeSide,
  { field: 'spanish' | 'english'; lang: string }
> = {
  Spanish: { field: 'spanish', lang: 'es' },
  English: { field: 'english', lang: 'en' },
}
