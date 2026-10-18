import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { FlashCard } from '../../api/flashCards'
import { defaultPreferences } from '../../api/preferences'
import { trackEvent, trackException } from '../../telemetry'
import { api, cat } from '../support/factories'
import { emptyResponse, jsonResponse, mockApi } from '../support/mockApi'
import type { Routes } from '../support/mockApi'
import { renderAt, signInForEachTest } from '../support/render'
import type { User } from '../support/render'

signInForEachTest()

describe('pictures', () => {
  const picture = { contentType: 'image/png', data: 'iVBORw0KGgo=' }
  const generateUrl = api('/flashcards/images/generate')
  const imageUrl = 'http://images.test/7.png'
  const gato = { ...cat, id: 7 }

  // Answers a request for a picture as told, and saves a card and its picture as the API would. Translation is
  // off, as it is locally.
  function mockPictures({
    generate = jsonResponse({ id: 1, ...picture }),
    putStatus = 200,
    cards = [],
    routes = {},
  }: {
    generate?: Response
    putStatus?: number
    cards?: FlashCard[]
    routes?: Routes
  } = {}) {
    return mockApi({
      'GET /flashcards': cards,
      'POST /flashcards/images/generate': generate,
      'POST /flashcards': jsonResponse(gato, 201),
      'PUT /flashcards/7': { ...cards[0], spanish: ['el gatos'] },
      'PUT /flashcards/7/image':
        putStatus === 200 ? { ...gato, imageUrl } : emptyResponse(putStatus),
      'DELETE /flashcards/7/image': gato,
      ...routes,
    }).calls
  }

  // Types the Spanish of a new card and asks for a picture of it.
  async function generatePicture(user: User) {
    await user.type(
      screen.getByLabelText('Spanish', { exact: false }),
      'el gato',
    )
    await user.click(screen.getByRole('button', { name: 'Generate picture' }))
    return await screen.findByRole('img', { name: 'Generated picture' })
  }

  it('offers a picture of the words, which the user can discard before saving', async () => {
    const user = userEvent.setup()
    const calls = mockPictures()
    renderAt('/')
    await screen.findByText('No flash cards yet.')
    expect(
      screen.getByRole('button', { name: 'Generate picture' }),
    ).toBeDisabled()

    const preview = await generatePicture(user)

    expect(preview).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    const generate = calls.all.find((call) => call.url === generateUrl)
    expect(generate?.init?.method).toBe('POST')
    expect(generate?.init?.body).toBe(
      JSON.stringify({ spanish: 'el gato', english: '' }),
    )
    expect(trackEvent).toHaveBeenCalledWith('FlashCardImageGenerated')

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    await user.type(
      screen.getByLabelText('English', { exact: false }),
      'the cat',
    )
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(await screen.findByText('el gato')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'Generated picture' }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'Picture for "el gato"' }),
    ).not.toBeInTheDocument()
    expect(calls.all.some((call) => call.url.endsWith('/image'))).toBe(false)
  })

  it("puts the picture on the card when it's saved", async () => {
    const user = userEvent.setup()
    const calls = mockPictures()
    renderAt('/')
    await screen.findByText('No flash cards yet.')
    await generatePicture(user)

    await user.type(
      screen.getByLabelText('English', { exact: false }),
      'the cat',
    )
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(
      await screen.findByRole('img', { name: 'Picture for "el gato"' }),
    ).toHaveAttribute('src', imageUrl)
    const put = calls.find('PUT')
    expect(put?.url).toBe(api('/flashcards/7/image'))
    expect(put?.init?.body).toBe(JSON.stringify(picture))
    expect(
      screen.queryByRole('img', { name: 'Generated picture' }),
    ).not.toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith('FlashCardImageAdded')
  })

  // A PNG file of the same bytes as the generated picture.
  const pngFile = new File(
    [Uint8Array.from(atob(picture.data), (char) => char.charCodeAt(0))],
    'cat.png',
    { type: 'image/png' },
  )

  it("puts an uploaded picture on the card when it's saved", async () => {
    const user = userEvent.setup()
    const calls = mockPictures()
    renderAt('/')
    await screen.findByText('No flash cards yet.')

    await user.upload(screen.getByLabelText('Upload picture'), pngFile)

    expect(
      await screen.findByRole('img', { name: 'Uploaded picture' }),
    ).toHaveAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    expect(trackEvent).toHaveBeenCalledWith('FlashCardImageUploaded')
    expect(calls.all.some((call) => call.url === generateUrl)).toBe(false)

    await user.type(
      screen.getByLabelText('Spanish', { exact: false }),
      'el gato',
    )
    await user.type(
      screen.getByLabelText('English', { exact: false }),
      'the cat',
    )
    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(
      await screen.findByRole('img', { name: 'Picture for "el gato"' }),
    ).toHaveAttribute('src', imageUrl)
    const put = calls.find('PUT')
    expect(put?.url).toBe(api('/flashcards/7/image'))
    expect(put?.init?.body).toBe(JSON.stringify(picture))
  })

  it.each([
    [
      'bigger than 5 MB',
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', {
        type: 'image/png',
      }),
      'The picture can be at most 5 MB.',
    ],
    [
      'not a picture',
      new File(['hola'], 'notes.txt', { type: 'text/plain' }),
      'The picture must be a JPEG, PNG or WebP.',
    ],
  ])('turns away an uploaded file %s', async (_, file, message) => {
    // The file picker only offers pictures, but the user can pick any file anyway.
    const user = userEvent.setup({ applyAccept: false })
    const calls = mockPictures()
    renderAt('/')
    await screen.findByText('No flash cards yet.')

    await user.upload(screen.getByLabelText('Upload picture'), file)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'Uploaded picture' }),
    ).not.toBeInTheDocument()

    // A picture within the limit is still taken afterwards.
    await user.upload(screen.getByLabelText('Upload picture'), pngFile)
    expect(
      await screen.findByRole('img', { name: 'Uploaded picture' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    expect(calls.all.some((call) => call.url.endsWith('/image'))).toBe(false)
  })

  it('can upload a picture in place of a generated one', async () => {
    const user = userEvent.setup()
    mockPictures()
    renderAt('/')
    await screen.findByText('No flash cards yet.')
    await generatePicture(user)

    await user.upload(screen.getByLabelText('Upload picture'), pngFile)

    expect(
      await screen.findByRole('img', { name: 'Uploaded picture' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: 'Generated picture' }),
    ).not.toBeInTheDocument()
  })

  it('can discard the picture and ask for another', async () => {
    const user = userEvent.setup()
    const calls = mockPictures()
    renderAt('/')
    await screen.findByText('No flash cards yet.')
    await generatePicture(user)

    await user.click(screen.getByRole('button', { name: 'Discard' }))

    expect(
      screen.queryByRole('img', { name: 'Generated picture' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generate picture' }),
    ).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Generate picture' }))

    expect(
      await screen.findByRole('img', { name: 'Generated picture' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Generate another picture' }),
    ).toBeInTheDocument()
    expect(calls.all.filter((call) => call.url === generateUrl)).toHaveLength(2)
  })

  it('asks for the next picture of the same words, and the first of new ones', async () => {
    const user = userEvent.setup()
    let id = 0
    const calls = mockPictures({
      routes: {
        'POST /flashcards/images/generate': () =>
          jsonResponse({ id: ++id, ...picture }),
      },
    })
    renderAt('/')
    await screen.findByText('No flash cards yet.')
    await generatePicture(user)
    const generateAnother = screen.getByRole('button', {
      name: 'Generate another picture',
    })

    await user.click(generateAnother)
    await waitFor(() => expect(id).toBe(2))
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await user.click(screen.getByRole('button', { name: 'Generate picture' }))
    await waitFor(() => expect(id).toBe(3))
    await user.type(
      screen.getByLabelText('English', { exact: false }),
      'the cat',
    )
    await user.click(
      screen.getByRole('button', { name: 'Generate another picture' }),
    )
    await waitFor(() => expect(id).toBe(4))

    expect(
      calls.all
        .filter((call) => call.url === generateUrl)
        .map((call) => call.body),
    ).toEqual([
      { spanish: 'el gato', english: '' },
      { spanish: 'el gato', english: '', afterId: 1 },
      { spanish: 'el gato', english: '', afterId: 2 },
      { spanish: 'el gato', english: 'the cat' },
    ])
  })

  it.each([
    [503, "Pictures aren't available."],
    [422, "That card can't be illustrated. Try other words."],
    [502, 'Unable to make a picture.'],
  ])(
    'says why when the API answers %i instead of a picture',
    async (status, message) => {
      const user = userEvent.setup()
      mockPictures({ generate: emptyResponse(status) })
      renderAt('/')
      await screen.findByText('No flash cards yet.')

      await user.type(
        screen.getByLabelText('Spanish', { exact: false }),
        'el gato',
      )
      await user.click(screen.getByRole('button', { name: 'Generate picture' }))

      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('img', { name: 'Generated picture' }),
      ).not.toBeInTheDocument()
    },
  )

  it("keeps the card when its picture can't be added", async () => {
    const user = userEvent.setup()
    mockPictures({ putStatus: 500 })
    renderAt('/')
    await screen.findByText('No flash cards yet.')
    await generatePicture(user)
    await user.type(
      screen.getByLabelText('English', { exact: false }),
      'the cat',
    )

    await user.click(screen.getByRole('button', { name: 'Add flash card' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Flash card saved, but the picture couldn't be added.",
    )
    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: /^Picture for/ }),
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Spanish', { exact: false })).toHaveValue('')
    expect(trackException).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'picture',
    })
  })

  it("shows each card's picture, and takes it off when the user removes it", async () => {
    const user = userEvent.setup()
    const calls = mockPictures({ cards: [{ ...gato, imageUrl }] })
    renderAt('/')
    expect(
      await screen.findByRole('img', { name: 'Picture for "el gato"' }),
    ).toHaveAttribute('src', imageUrl)

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    const item = screen.getByRole('listitem')
    expect(
      within(item).getByRole('img', { name: "The card's picture" }),
    ).toHaveAttribute('src', imageUrl)
    await user.click(
      within(item).getByRole('button', { name: 'Remove picture' }),
    )
    expect(
      within(item).queryByRole('img', { name: "The card's picture" }),
    ).not.toBeInTheDocument()
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
    })
    expect(screen.getByText('el gato')).toBeInTheDocument()
    expect(
      screen.queryByRole('img', { name: /^Picture for/ }),
    ).not.toBeInTheDocument()
    expect(
      calls.all
        .filter((call) => call.method !== 'GET')
        .map((call) => `${call.method} ${call.url}`),
    ).toEqual([
      `PUT ${api('/flashcards/7')}`,
      `DELETE ${api('/flashcards/7/image')}`,
    ])
    expect(trackEvent).toHaveBeenCalledWith('FlashCardImageRemoved')
  })

  it("shows a new picture in place of the card's, and puts it on the card when it's saved", async () => {
    const user = userEvent.setup()
    const calls = mockPictures({ cards: [{ ...gato, imageUrl }] })
    renderAt('/')
    await screen.findByRole('img', { name: 'Picture for "el gato"' })

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    const item = screen.getByRole('listitem')
    await user.click(
      within(item).getByRole('button', { name: 'Generate another picture' }),
    )

    expect(
      await within(item).findByRole('img', { name: 'Generated picture' }),
    ).toBeInTheDocument()
    expect(
      within(item).queryByRole('img', { name: "The card's picture" }),
    ).not.toBeInTheDocument()
    expect(
      within(item).queryByRole('button', { name: 'Remove picture' }),
    ).not.toBeInTheDocument()

    // Discarding it brings the card's own back.
    await user.click(within(item).getByRole('button', { name: 'Discard' }))
    expect(
      within(item).getByRole('img', { name: "The card's picture" }),
    ).toHaveAttribute('src', imageUrl)

    await user.click(
      within(item).getByRole('button', { name: 'Generate another picture' }),
    )
    await within(item).findByRole('img', { name: 'Generated picture' })
    await user.click(within(item).getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
    })
    const put = calls.find('PUT', '/flashcards/7/image')
    expect(put?.init?.body).toBe(JSON.stringify(picture))
    expect(calls.some('DELETE')).toBe(false)
  })

  it('keeps the picture when the edit is cancelled', async () => {
    const user = userEvent.setup()
    const calls = mockPictures({ cards: [{ ...gato, imageUrl }] })
    renderAt('/')
    await screen.findByRole('img', { name: 'Picture for "el gato"' })

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(
      screen.getByRole('img', { name: 'Picture for "el gato"' }),
    ).toHaveAttribute('src', imageUrl)
    // Only the page's loads: cancelling sends nothing.
    expect(calls.all.filter((call) => call.method !== 'GET')).toEqual([])

    // The next edit starts over with the picture still there.
    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    expect(
      screen.getByRole('img', { name: "The card's picture" }),
    ).toBeInTheDocument()
  })

  it('neither shows pictures nor offers one when the user turned pictures off', async () => {
    const user = userEvent.setup()
    const calls = mockPictures({
      cards: [{ ...gato, imageUrl }],
      routes: {
        'GET /preferences': { ...defaultPreferences, showPictures: false },
      },
    })
    renderAt('/')
    await screen.findByText('el gato')

    expect(
      screen.queryByRole('img', { name: /picture/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Generate picture' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit "el gato"' }))
    expect(
      screen.queryByRole('img', { name: /picture/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /picture/ }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // The card keeps its picture.
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Save' }),
      ).not.toBeInTheDocument()
    })
    expect(
      calls.all
        .filter((call) => call.method !== 'GET')
        .map((call) => `${call.method} ${call.url}`),
    ).toEqual([`PUT ${api('/flashcards/7')}`])
  })
})
