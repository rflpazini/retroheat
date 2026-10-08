import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccountProvider, useAccount } from '../lib/account'
import type { BarcodeIndexFile } from '../lib/barcode'
import { resetCache } from '../lib/data'
import type { DetectedCode, ScanDeps } from '../lib/scanner'
import type { CollectionItem, ShelfBackend } from '../lib/shelf'
import { memoryBackend, testUser } from '../lib/shelf-memory'
import { Collection } from '../pages/Collection'
import { AppShell } from './AppShell'
import { ScanDialog } from './ScanDialog'

const dataDir = path.resolve(__dirname, '../../../data')
const present = fs.existsSync(path.join(dataDir, 'catalog.json'))

// Silent Hill 2's black label and its Greatest Hits reprint, as eBay's catalog lists them.
const BLACK_LABEL = '083717200253'
const GREATEST_HITS = '083717200505'
// A made-up code with a valid check digit, standing in for a second game's box.
const BULLY = '0710425272295'
const index: BarcodeIndexFile = {
  as_of: '2026-10-08T00:00:00Z',
  codes: {
    '0083717200253': { id: 'silent-hill-2-ps2' },
    '0083717200505': { id: 'silent-hill-2-ps2', variant: 'greatest-hits' },
    '0710425272295': { id: 'bully-ps2' },
  },
}

/** The repo's data, with a barcode index of its own until the collector writes one. */
function serveData(barcodes: BarcodeIndexFile | null = index, opts: { catalog?: boolean } = {}) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    const rel = url.slice(url.indexOf('/data/') + '/data/'.length)
    if (rel === 'catalog.json' && opts.catalog === false) throw new TypeError('Failed to fetch')
    if (rel === 'barcodes.json') {
      return barcodes ? new Response(JSON.stringify(barcodes), { status: 200 }) : new Response('{}', { status: 404 })
    }
    const file = path.join(dataDir, rel)
    if (!fs.existsSync(file)) return new Response('{}', { status: 404 })
    return new Response(fs.readFileSync(file, 'utf8'), { status: 200 })
  })
}

/** A camera that shows whatever barcode the test holds up, read by a detector that always agrees. */
function fakeScanner(opts: { camera?: 'ok' | 'refused' } = {}) {
  const view = { code: null as string | null }
  const track = { stop: vi.fn(), getCapabilities: () => ({}) }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  const deps: ScanDeps = {
    openCamera: vi.fn(async () => {
      if (opts.camera === 'refused') throw new DOMException('Permission denied', 'NotAllowedError')
      return stream
    }),
    loadDetector: async () => ({
      detect: async (): Promise<DetectedCode[]> =>
        view.code ? [{ rawValue: view.code, format: view.code.length === 12 ? 'upc_a' : 'ean_13' }] : [],
    }),
    imageOf: async () => ({}) as ImageBitmapSource,
    interval: 5,
    pairsTimeout: 3000,
  }
  return { view, track, deps }
}

/** The window as the shell opens it: only once the shelf is in, and gone again on Done. */
function Harness({ deps }: { deps: ScanDeps }) {
  const account = useAccount()
  const [open, setOpen] = useState(true)
  if (account.status !== 'signed-in' || account.collection.status !== 'ready') return <p>loading</p>
  return open ? <ScanDialog deps={deps} onClose={() => setOpen(false)} /> : <p>closed</p>
}

function renderScanner(
  deps: ScanDeps,
  seed: { collection?: CollectionItem[] } = {},
  /** Changes the backend before the window opens, e.g. to make a write slow or fail. */
  tweak?: (backend: ShelfBackend) => void,
) {
  const { backend, state } = memoryBackend({ user: testUser, ...seed })
  tweak?.(backend)
  render(
    <MemoryRouter>
      <AccountProvider backend={() => Promise.resolve(backend)}>
        <Harness deps={deps} />
      </AccountProvider>
    </MemoryRouter>,
  )
  return state
}

const confirmFor = (title: string) => screen.findByRole('form', { name: `Add ${title}` }, { timeout: 3000 })

/** A promise the test settles by hand, for a write that is still on its way. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe.skipIf(!present)('scanning a box onto the shelf', () => {
  beforeEach(() => {
    resetCache()
    serveData()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('finds the game and its edition, adds it as complete with what was paid, and waits for the next box', async () => {
    const { view, deps } = fakeScanner()
    const state = renderScanner(deps)
    const user = userEvent.setup()

    await screen.findByText(/point the camera at the barcode/i)
    view.code = GREATEST_HITS
    const form = await confirmFor('Silent Hill 2')
    expect(form.textContent).toContain('Greatest Hits')
    expect(form.textContent).toContain('0 83717 20050 5')
    // Complete is chosen before anything is pressed: the box is in hand.
    expect(within(form).getByRole('button', { name: 'Complete' }).getAttribute('aria-pressed')).toBe('true')
    // Return adds: the default button has the focus once the window settles.
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Add to Shelf'))

    await user.type(within(form).getByLabelText(/paid for silent hill 2/i), '12.50')
    await user.click(within(form).getByRole('button', { name: 'Add to Shelf' }))

    await waitFor(() => expect(state.copyOf('silent-hill-2-ps2')).toBeDefined())
    expect(state.copyOf('silent-hill-2-ps2')).toMatchObject({
      condition: 'cib',
      paid_cents: 1250,
      edition: 'greatest-hits',
      barcode: '0083717200505',
    })
    // The scanner asked for the price itself; no second window comes up between boxes.
    expect(screen.queryByRole('dialog', { name: /on the shelf/i })).toBeNull()
    const session = await screen.findByRole('list', { name: /added this session/i })
    expect(session.textContent).toMatch(/Silent Hill 2.*Complete.*Greatest Hits/)

    // Still in view, the same box is not read twice.
    await screen.findByText(/point the camera at the barcode/i)
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByRole('form', { name: 'Add Silent Hill 2' })).toBeNull()

    // Taken away and shown again, it is: a second copy of the same game.
    view.code = null
    await new Promise((r) => setTimeout(r, 60))
    view.code = BLACK_LABEL
    const again = await confirmFor('Silent Hill 2')
    expect(again.textContent).toMatch(/already on your shelf: 1 copy \(complete\)/i)
    expect(again.textContent).not.toContain('Greatest Hits')
  })

  it('takes a copy back off the shelf with Undo', async () => {
    const { view, deps } = fakeScanner()
    const state = renderScanner(deps)
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    const form = await confirmFor('Silent Hill 2')
    await user.click(within(form).getByRole('button', { name: 'Sealed' }))
    await user.click(within(form).getByRole('button', { name: 'Add to Shelf' }))
    await waitFor(() => expect(state.copyOf('silent-hill-2-ps2')?.condition).toBe('new'))

    await user.click(await screen.findByRole('button', { name: 'Undo Silent Hill 2' }))
    await waitFor(() => expect(state.copyOf('silent-hill-2-ps2')).toBeUndefined())
    expect(screen.queryByRole('list', { name: /added this session/i })).toBeNull()
  })

  it('pairs a barcode it does not know with the game picked by hand, and knows it from then on', async () => {
    const { view, deps } = fakeScanner()
    const state = renderScanner(deps)
    const user = userEvent.setup()

    view.code = '4901234567894'
    expect(await screen.findByText(/which game is this/i, undefined, { timeout: 3000 })).toBeDefined()
    expect(document.body.textContent).toContain('4 901234 567894')
    await user.type(screen.getByLabelText(/find the game/i), 'silent hill 2')
    const hits = await screen.findByRole('list', { name: /matching games/i })
    await user.click(within(hits).getAllByRole('button')[0])

    const form = await confirmFor('Silent Hill 2')
    await user.click(within(form).getByRole('button', { name: 'Add to Shelf' }))
    await waitFor(() => expect(state.barcodePairs.get('4901234567894')).toBe('silent-hill-2-ps2'))
    expect(state.copyOf('silent-hill-2-ps2')).toMatchObject({ barcode: '4901234567894', edition: null })

    view.code = null
    await new Promise((r) => setTimeout(r, 60))
    view.code = '4901234567894'
    const again = await confirmFor('Silent Hill 2')
    expect(again.textContent).toMatch(/already on your shelf/i)
  })

  it('says why the camera did not open, and still takes the number typed by hand', async () => {
    const { deps } = fakeScanner({ camera: 'refused' })
    renderScanner(deps)
    const user = userEvent.setup()

    expect(await screen.findByText(/camera access was refused/i)).toBeDefined()
    await user.click(screen.getByRole('button', { name: 'Type Number…' }))
    const field = screen.getByLabelText(/the number under the bars/i)
    await user.type(field, '08371720025{Enter}')
    expect(await screen.findByText(/that is not a whole barcode/i)).toBeDefined()

    await user.clear(field)
    await user.type(field, '0 83717 20025 3{Enter}')
    const form = await confirmFor('Silent Hill 2')
    expect(form.textContent).toContain('0 83717 20025 3')
  })

  it('treats a missing barcode file as knowing no barcodes yet', async () => {
    resetCache()
    serveData(null)
    const { view, deps } = fakeScanner()
    renderScanner(deps)
    view.code = BLACK_LABEL
    expect(await screen.findByText(/which game is this/i, undefined, { timeout: 3000 })).toBeDefined()
  })

  it('steps back with Escape, closes with Escape, and turns the camera off when it closes', async () => {
    const { view, track, deps } = fakeScanner()
    renderScanner(deps)
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    await confirmFor('Silent Hill 2')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add Silent Hill 2' })).toBeNull())
    expect(screen.getByRole('dialog', { name: /scan barcode/i })).toBeDefined()

    await user.keyboard('{Escape}')
    expect(await screen.findByText('closed')).toBeDefined()
    expect(track.stop).toHaveBeenCalled()
  })
})

describe.skipIf(!present)('the scanner under a slow or failing store', () => {
  beforeEach(() => {
    resetCache()
    serveData()
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('writes one copy however many times Add to Shelf is pressed while the first write is on its way', async () => {
    const { view, deps } = fakeScanner()
    const slow = deferred<void>()
    let calls = 0
    const state = renderScanner(deps, {}, (backend) => {
      const add = backend.addCopy
      backend.addCopy = async (copy) => {
        calls++
        await slow.promise
        return add(copy)
      }
    })
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    const form = await confirmFor('Silent Hill 2')
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Add to Shelf'))
    const button = within(form).getByRole('button', { name: 'Add to Shelf' })
    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    await user.click(button)
    await user.dblClick(button)
    slow.resolve()
    await waitFor(() => expect(state.copiesOf('silent-hill-2-ps2')).toHaveLength(1))
    await sleep(50)
    expect(calls).toBe(1)
    expect(state.copiesOf('silent-hill-2-ps2')).toHaveLength(1)
  })

  it('keeps the next box on screen when an earlier add finishes late', async () => {
    const { view, deps } = fakeScanner()
    const slow = deferred<void>()
    const state = renderScanner(deps, {}, (backend) => {
      const add = backend.addCopy
      backend.addCopy = async (copy) => {
        await slow.promise
        return add(copy)
      }
    })
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    const first = await confirmFor('Silent Hill 2')
    await user.click(within(first).getByRole('button', { name: 'Add to Shelf' }))
    // Gave up waiting, went back to the camera, and held up the next box.
    await user.keyboard('{Escape}')
    view.code = BULLY
    await confirmFor('Bully')

    slow.resolve()
    await waitFor(() => expect(state.copyOf('silent-hill-2-ps2')).toBeDefined())
    await sleep(50)
    expect(screen.getByRole('form', { name: 'Add Bully' })).toBeDefined()
    expect(document.activeElement?.closest('form')?.getAttribute('aria-label')).toBe('Add Bully')
  })

  it('puts focus on the window after an add, so a second Return cannot close it', async () => {
    const { view, deps } = fakeScanner()
    const state = renderScanner(deps)
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    await confirmFor('Silent Hill 2')
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Add to Shelf'))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(state.copyOf('silent-hill-2-ps2')).toBeDefined())
    const dialog = screen.getByRole('dialog', { name: /scan barcode/i })
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await user.keyboard('{Enter}')
    expect(screen.queryByText('closed')).toBeNull()
    expect(screen.getByRole('dialog', { name: /scan barcode/i })).toBeDefined()
  })

  // A store from before 0004 names no copy, so an empty shelf there takes the
  // write: the copy is on the shelf, and saying otherwise invites a duplicate.
  it('lists a copy the store added without naming it, with no Undo to offer', async () => {
    const { view, deps } = fakeScanner()
    renderScanner(deps, {}, (backend) => {
      const add = backend.addCopy
      backend.addCopy = async (copy) => {
        const { id: _id, ...unnamed } = await add(copy)
        return unnamed
      }
    })
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    const form = await confirmFor('Silent Hill 2')
    await user.click(within(form).getByRole('button', { name: 'Add to Shelf' }))
    const list = await screen.findByRole('list', { name: /added this session/i })
    expect(list.textContent).toContain('Silent Hill 2')
    expect(screen.queryByText(/was not added/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Undo Silent Hill 2' })).toBeNull()
  })

  it('keeps the session row when Undo could not take the copy off the shelf', async () => {
    const { view, deps } = fakeScanner()
    const state = renderScanner(deps, {}, (backend) => {
      backend.removeCopy = async () => {
        throw new Error('offline')
      }
    })
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    const form = await confirmFor('Silent Hill 2')
    await user.click(within(form).getByRole('button', { name: 'Add to Shelf' }))
    await user.click(await screen.findByRole('button', { name: 'Undo Silent Hill 2' }))
    expect(await screen.findByText(/was not taken off/i)).toBeDefined()
    expect(screen.getByRole('list', { name: /added this session/i }).textContent).toContain('Silent Hill 2')
    expect(state.copyOf('silent-hill-2-ps2')).toBeDefined()
  })

  it('lets the camera go while the page is hidden and opens it again on return', async () => {
    const { track, deps } = fakeScanner()
    renderScanner(deps)
    await screen.findByText(/point the camera at the barcode/i)
    expect(deps.openCamera).toHaveBeenCalledTimes(1)

    let visibility: DocumentVisibilityState = 'hidden'
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(track.stop).toHaveBeenCalled())

    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    await waitFor(() => expect(deps.openCamera).toHaveBeenCalledTimes(2))
    await screen.findByText(/point the camera at the barcode/i)
    spy.mockRestore()
  })

  it('never sends a known box to be paired by hand when the game list did not load', async () => {
    resetCache()
    serveData(index, { catalog: false })
    const { view, deps } = fakeScanner()
    renderScanner(deps)
    const user = userEvent.setup()

    view.code = BLACK_LABEL
    expect(await screen.findByText(/game list did not load/i, undefined, { timeout: 3000 })).toBeDefined()
    expect(screen.queryByText(/which game is this/i)).toBeNull()
    // Typed by hand, the same refusal, and still no pairing step.
    await user.click(screen.getByRole('button', { name: 'Type Number…' }))
    await user.type(screen.getByLabelText(/the number under the bars/i), `${BLACK_LABEL}{Enter}`)
    expect(screen.queryByText(/which game is this/i)).toBeNull()
  })

  it('offers no typed number or photo until it knows the catalog, the barcodes and your pairings', async () => {
    const { deps } = fakeScanner()
    const never = deferred<never>()
    renderScanner({ ...deps, pairsTimeout: 60_000 }, {}, (backend) => {
      backend.listBarcodePairs = () => never.promise
    })
    const dialog = await screen.findByRole('dialog', { name: /scan barcode/i })
    expect(within(dialog).getByRole('button', { name: 'Type Number…' }).hasAttribute('disabled')).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Choose Photo…' }).hasAttribute('disabled')).toBe(true)
    expect(within(dialog).getByRole('status').textContent).toMatch(/starting/i)
  })

  it('starts scanning without your pairings when they are slow, and merges them when they come', async () => {
    const { view, deps } = fakeScanner()
    const late = deferred<{ code: string; game_id: string }[]>()
    renderScanner({ ...deps, pairsTimeout: 50 }, {}, (backend) => {
      backend.listBarcodePairs = () => late.promise
    })
    const user = userEvent.setup()

    // Scanning starts on the catalog alone.
    view.code = GREATEST_HITS
    await confirmFor('Silent Hill 2')
    await user.keyboard('{Escape}')

    // The pairings arrive late, and a box paired on another device now scans.
    late.resolve([{ code: '4901234567894', game_id: 'bully-ps2' }])
    await sleep(20)
    view.code = '4901234567894'
    expect(await confirmFor('Bully')).toBeDefined()
  })
})

describe.skipIf(!present)('opening the scanner', () => {
  // A browser with its own reader, as Android's Chrome is, so the window
  // never fetches the bundled one here.
  class NativeDetector {
    static getSupportedFormats = async () => ['upc_a', 'ean_13', 'upc_e']
    detect = async () => []
  }
  beforeEach(() => {
    resetCache()
    serveData()
    vi.stubGlobal('BarcodeDetector', NativeDetector)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function renderShell(route: string) {
    const { backend } = memoryBackend({ user: testUser })
    return render(
      <MemoryRouter initialEntries={[route]}>
        <AccountProvider backend={() => Promise.resolve(backend)}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route index element={<p>home page</p>} />
              <Route path="collection" element={<Collection />} />
            </Route>
          </Routes>
        </AccountProvider>
      </MemoryRouter>,
    )
  }

  it('opens from the Scan button beside the add field, and says plainly when there is no camera', async () => {
    renderShell('/collection')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Scan' }, { timeout: 3000 }))
    const dialog = await screen.findByRole('dialog', { name: /scan barcode/i }, { timeout: 5000 })
    // jsdom has no camera; the window says so and offers the typed number.
    expect(await within(dialog).findByText(/cannot open a camera|secure \(https\)/i, undefined, { timeout: 5000 })).toBeDefined()
    expect(within(dialog).getByRole('button', { name: 'Type Number…' })).toBeDefined()
  })

  it('opens straight away from the home-screen shortcut', async () => {
    renderShell('/collection?scan=1')
    expect(await screen.findByRole('dialog', { name: /scan barcode/i }, { timeout: 5000 })).toBeDefined()
  })
})
