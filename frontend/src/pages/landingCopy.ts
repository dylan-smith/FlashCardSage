// The words on the landing page that signed-out visitors see (LandingPage.tsx). They're here, not in the page,
// so the page exports only its component and the tests can check the same strings.

export const headline = 'Spanish flash cards that build themselves'

export const subhead =
  "Type one word and FlashCardSage translates it, tags it and draws a picture. Import your tutor's notes, your " +
  'Duolingo or Preply word list, or a built-in deck, then practice in your spare minutes, even offline.'

export const highlights = [
  'Free, with nothing to install',
  'Only you can see your cards',
  'Works with Claude, ChatGPT and Claude Code',
]

export type Feature = {
  title: string
  description: string
  // The short, silent clip of the feature in public/demos/, without its extension: a .mp4 and a .jpg poster. The
  // name carries a version (-v1), so a new cut gets a new name and the old one can be cached for a year.
  demo: string
}

// In the order the demo clips tell the story, with the same names the app itself uses, so what people read here
// matches what they see once they sign in.
export const features: Feature[] = [
  {
    title: 'Type one word. AI does the rest.',
    description:
      'Type a word in English or Spanish and the other side fills in. It suggests tags from your own, and can draw a picture of what the card means, or you upload one.',
    demo: '/demos/add-card-v1',
  },
  {
    title: 'Suggested cards that match what you’re learning',
    description:
      'Below your cards, AI suggests new words and phrases that go with the ones you have. Filter by a tag and the suggestions follow. Add one with a click.',
    demo: '/demos/suggested-cards-v1',
  },
  {
    title: 'Start from a built-in deck',
    description:
      'About 30 decks with pictures, such as Numbers, Food and Common verbs. Add a whole deck, or just the cards you want; they’re then yours to change.',
    demo: '/demos/built-in-decks-v1',
  },
  {
    title: 'Cards from your tutor’s notes',
    description:
      'Upload a lesson plan, an article or a story (.txt, .md, .docx, .pdf and more) and it finds up to 100 words and phrases to make cards for. Change or drop any before you add them.',
    demo: '/demos/document-v1',
  },
  {
    title: 'Bring in your Duolingo or Preply words',
    description:
      'One click of a bookmarklet on your Duolingo word list or your Preply vocabulary page brings every word in as a card, in a deck of its own.',
    demo: '/demos/website-v1',
  },
  {
    title: 'Ask your AI assistant for cards',
    description:
      'Connect Claude, ChatGPT or Claude Code and just ask: “Make me 20 cards for playing sports.” It can see, add and change your cards, tags and decks, and read your practice scores.',
    demo: '/demos/assistant-v1',
  },
  {
    title: 'Practice in spare minutes',
    description:
      'Card, reveal, right or wrong. It shows you more of the words you keep getting wrong, reads the Spanish aloud, and works offline once you’ve opened it. Or practice your words in context, in sentences AI writes from your cards. Install it on your phone as an app.',
    demo: '/demos/practice-v1',
  },
]
