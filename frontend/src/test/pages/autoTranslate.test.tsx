import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FlashCard } from '../../api/flashCards'
import { defaultPreferences } from '../../api/preferences'
import { translateDelayMs } from '../../hooks/useAutoTranslate'
import { api, card, cat } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import type { Call, Routes } from '../support/mockApi'
import { renderAt, signInForEachTest, waitForLoaded } from '../support/render'

signInForEachTest()

describe('auto translation', () => {
  // waitFor gives up after a second by default, which is about how long a translation waits for typing to stop.
  const untilTranslated = { timeout: translateDelayMs + 1000 }

  const autoTranslated = 'Auto-translated: edit to change'

  const dictionary: Record<string, string> = {
    'el gato': 'the cat',
    'the dog': 'el perro',
    'el perro': 'the dog',
  }

  // The time a translation waits for typing to stop passes without waiting for it.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Answers translations with translate (by default from the dictionary, and a 503 for anything else), saves
  // cards as sent and lists cards, answering anything else from routes.
  function mockTranslations(
    cards: FlashCard[] = [],
    translate: (text: string) => Promise<Response> = async (text) =>
      text in dictionary
        ? jsonResponse({ translation: dictionary[text] })
        : emptyResponse(503),
    routes: Routes = {},
  ) {
    const { calls } = mockApi({
      'GET /flashcards': cards,
      'POST /translations': (call: Call) =>
        translate((call.body as { text: string }).text),
      // These tests don't tag cards, so a saved card has no tags.
      'POST /flashcards': (call: Call) =>
        jsonResponse(
          { id: 7, ...(call.body as object), tags: [], imageUrl: null },
          201,
        ),
      'PUT /flashcards/1': (call: Call) =>
        jsonResponse({
          id: 1,
          ...(call.body as object),
          tags: [],
          imageUrl: null,
        }),
      ...routes,
    })
    return () => calls.filter('POST', '/translations')
  }

  // Long enough for a translation to have been sent, for checking that one wasn't.
  function waitPastTranslateDelay() {
    return act(() => vi.advanceTimersByTimeAsync(translateDelayMs + 200))
  }

  async function showForm() {
    renderAt('/')
    await waitForLoaded()
    return {
      spanish: screen.getAllByLabelText('Spanish', { exact: false })[0],
      english: screen.getAllByLabelText('English', { exact: false })[0],
    }
  }

  it('fills in the English from the Spanish, once the user stops typing', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations()
    const { spanish, english } = await showForm()

    await user.type(spanish, 'el gato')

    await waitFor(() => expect(english).toHaveValue('the cat'), untilTranslated)
    expect(screen.getByText(autoTranslated)).toBeInTheDocument()
    expect(translations()).toHaveLength(1)
    expect(translations()[0].url).toBe(api('/translations'))
    expect(translations()[0].init?.body).toBe(
      JSON.stringify({ text: 'el gato', from: 'Spanish' }),
    )

    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(await screen.findByText('the cat')).toBeInTheDocument()
    expect(english).toHaveValue('')
    expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
  })

  it('fills in the Spanish from the English', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations()
    const { spanish, english } = await showForm()

    await user.type(english, 'the dog')

    await waitFor(
      () => expect(spanish).toHaveValue('el perro'),
      untilTranslated,
    )
    expect(translations()[0].init?.body).toBe(
      JSON.stringify({ text: 'the dog', from: 'English' }),
    )
  })

  it('keeps what the user typed over a translation', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations()
    const { spanish, english } = await showForm()
    await user.type(spanish, 'el gato')
    await waitFor(() => expect(english).toHaveValue('the cat'), untilTranslated)

    await user.clear(english)
    await user.type(english, 'the kitty')
    await user.type(spanish, ' negro')
    await waitPastTranslateDelay()

    expect(english).toHaveValue('the kitty')
    expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
    expect(translations()).toHaveLength(1)
  })

  it("doesn't overwrite what the user types while a translation is on its way", async () => {
    const user = userEvent.setup()
    let answer: (response: Response) => void = () => {}
    const translations = mockTranslations(
      [],
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const { spanish, english } = await showForm()
    await user.type(spanish, 'el gato')
    await waitFor(() => expect(translations()).toHaveLength(1), untilTranslated)
    expect(screen.getByText('Translating…')).toBeInTheDocument()

    await user.type(english, 'my cat')
    answer(jsonResponse({ translation: 'the cat' }))
    await waitPastTranslateDelay()

    expect(english).toHaveValue('my cat')
    expect(screen.queryByText('Translating…')).not.toBeInTheDocument()
  })

  it("offers a word's other meanings, and keeps the one the user picks", async () => {
    const user = userEvent.setup()
    mockTranslations([], async () =>
      jsonResponse({
        translation: 'silla',
        alternatives: ['cátedra', 'presidente'],
      }),
    )
    const { spanish, english } = await showForm()

    await user.type(english, 'chair')
    await waitFor(() => expect(spanish).toHaveValue('silla'), untilTranslated)
    expect(screen.getByText('Other meanings:')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'silla' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'presidente' }))

    expect(spanish).toHaveValue('presidente')
    expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'silla' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'presidente' }),
    ).not.toBeInTheDocument()

    await user.type(english, 's')
    await waitPastTranslateDelay()

    expect(spanish).toHaveValue('presidente')
    expect(screen.queryByText('Other meanings:')).not.toBeInTheDocument()
  })

  it('leaves a cleared side empty, and translates it again with its button', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations()
    const { spanish, english } = await showForm()
    await user.type(spanish, 'el gato')
    await waitFor(() => expect(english).toHaveValue('the cat'), untilTranslated)
    expect(
      screen.queryByRole('button', { name: 'Translate from Spanish' }),
    ).not.toBeInTheDocument()

    await user.clear(english)
    await waitPastTranslateDelay()
    expect(english).toHaveValue('')
    expect(translations()).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Translate from Spanish' }),
    ).toBeInTheDocument()

    await user.type(english, 'the kitty')
    await user.click(
      screen.getByRole('button', { name: 'Translate from Spanish' }),
    )

    await waitFor(() => expect(english).toHaveValue('the cat'))
    expect(screen.getByText(autoTranslated)).toBeInTheDocument()
    expect(translations()).toHaveLength(2)
    expect(translations()[1].init?.body).toBe(
      JSON.stringify({ text: 'el gato', from: 'Spanish' }),
    )
  })

  it('translates what the user typed over a translation the other way', async () => {
    const user = userEvent.setup()
    mockTranslations()
    const { spanish, english } = await showForm()
    await user.type(spanish, 'el gato')
    await waitFor(() => expect(english).toHaveValue('the cat'), untilTranslated)

    await user.clear(english)
    await user.type(english, 'the dog')
    await user.click(
      screen.getByRole('button', { name: 'Translate from English' }),
    )

    await waitFor(() => expect(spanish).toHaveValue('el perro'))
    expect(english).toHaveValue('the dog')
    expect(screen.getByText(autoTranslated)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Translate from/ }),
    ).not.toBeInTheDocument()
  })

  it('hands a side back to translation with its button', async () => {
    const user = userEvent.setup()
    mockTranslations([], async () =>
      jsonResponse({
        translation: 'silla',
        alternatives: ['cátedra', 'presidente'],
      }),
    )
    const { spanish, english } = await showForm()
    await user.type(english, 'chair')
    await waitFor(() => expect(spanish).toHaveValue('silla'), untilTranslated)
    await user.click(screen.getByRole('button', { name: 'presidente' }))

    await user.click(
      screen.getByRole('button', { name: 'Translate from English' }),
    )

    await waitFor(() => expect(spanish).toHaveValue('silla'))
    expect(screen.getByText(autoTranslated)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Translate from English' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'presidente' }),
    ).toBeInTheDocument()
  })

  it("doesn't offer other meanings for a phrase", async () => {
    const user = userEvent.setup()
    mockTranslations()
    const { spanish, english } = await showForm()

    await user.type(spanish, 'el gato')

    await waitFor(() => expect(english).toHaveValue('the cat'), untilTranslated)
    expect(screen.queryByText('Other meanings:')).not.toBeInTheDocument()
  })

  it('clears a translation when its side is cleared', async () => {
    const user = userEvent.setup()
    mockTranslations()
    const { spanish, english } = await showForm()
    await user.type(spanish, 'el gato')
    await waitFor(() => expect(english).toHaveValue('the cat'), untilTranslated)

    await user.clear(spanish)

    expect(english).toHaveValue('')
    expect(screen.queryByText(autoTranslated)).not.toBeInTheDocument()
  })

  it('leaves the other side to the user when translation fails', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations()
    const { spanish, english } = await showForm()

    await user.type(spanish, 'la casa')
    await waitFor(() => expect(translations()).toHaveLength(1), untilTranslated)
    await waitPastTranslateDelay()

    expect(english).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Translating…')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^Translate from/ }),
    ).not.toBeInTheDocument()
  })

  it('leaves both sides to the user when they turned translation off', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations([], undefined, {
      'GET /preferences': { ...defaultPreferences, autoTranslate: false },
    })
    const { spanish, english } = await showForm()

    await user.type(spanish, 'el gato')
    await waitPastTranslateDelay()

    expect(translations()).toEqual([])
    expect(english).toHaveValue('')
    expect(screen.queryByText('Translating…')).not.toBeInTheDocument()

    await user.type(english, 'the kitty')
    await user.clear(spanish)
    await waitPastTranslateDelay()

    expect(translations()).toEqual([])
    expect(
      screen.queryByRole('button', { name: /^Translate from/ }),
    ).not.toBeInTheDocument()
  })

  it('translates a changed side of a card being edited', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations([cat])
    await showForm()

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    const item = screen.getAllByRole('listitem')[0]
    const spanish = within(item).getByLabelText('Spanish')
    const english = within(item).getByLabelText('English')
    await user.clear(spanish)
    await user.type(spanish, 'el perro')
    await waitFor(() => expect(english).toHaveValue('the dog'), untilTranslated)
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('the dog')).toBeInTheDocument()
    expect(translations()).toHaveLength(1)
  })

  it('translates a cleared side of a card being edited with its button', async () => {
    const user = userEvent.setup()
    const translations = mockTranslations([card(1, 'el gato', 'a cat')])
    await showForm()

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    const item = screen.getAllByRole('listitem')[0]
    const english = within(item).getByLabelText('English')
    expect(
      within(item).queryByRole('button', { name: /^Translate from/ }),
    ).not.toBeInTheDocument()
    await user.clear(english)
    await user.click(
      within(item).getByRole('button', { name: 'Translate from Spanish' }),
    )

    await waitFor(() => expect(english).toHaveValue('the cat'))
    expect(translations()).toHaveLength(1)
  })
})
