import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { normalizeBarcode } from './barcode'
import { cameraProblem, FORMATS, loadDetector, torchOf } from './scanner'

const wasmFile = path.resolve(__dirname, '../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')

// A UPC-A drawn module by module, as the frame of a camera would hold it:
// guards, six left digits, the centre, six right digits, quiet zones round it.
const LEFT = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
function upcImage(code: string): ImageData {
  const right = (d: number) => [...LEFT[d]].map((b) => (b === '1' ? '0' : '1')).join('')
  const digits = [...code].map(Number)
  const bits =
    '0'.repeat(12) +
    '101' +
    digits
      .slice(0, 6)
      .map((d) => LEFT[d])
      .join('') +
    '01010' +
    digits.slice(6).map(right).join('') +
    '101' +
    '0'.repeat(12)
  const scale = 3
  const width = bits.length * scale
  const height = 60
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = bits[Math.floor(x / scale)] === '1' ? 0 : 255
      data.set([v, v, v, 255], (y * width + x) * 4)
    }
  }
  return new ImageData(data, width, height)
}

// jsdom has no ImageData, and the reader tells one apart with instanceof.
class FakeImageData {
  colorSpace = 'srgb'
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('choosing a barcode reader', () => {
  it("uses the browser's own detector when it reads every box format", async () => {
    class Native {
      static getSupportedFormats = async () => ['qr_code', ...FORMATS]
      constructor(public options: { formats: string[] }) {}
      detect = async () => []
    }
    vi.stubGlobal('BarcodeDetector', Native)
    const d = await loadDetector()
    expect(d).toBeInstanceOf(Native)
    expect((d as unknown as Native).options.formats).toEqual([...FORMATS])
  })

  // Safari on an iPhone: no detector of its own, so the bundled ZXing reads
  // the box, and its .wasm comes from this site, never from a CDN.
  it('falls back to the bundled reader, served from this site, and reads a real UPC-A', async () => {
    class PartialNative {
      static getSupportedFormats = async () => ['qr_code']
    }
    vi.stubGlobal('BarcodeDetector', PartialNative)
    vi.stubGlobal('ImageData', FakeImageData)
    const asked: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input)
      asked.push(url)
      if (!url.endsWith('.wasm')) return new Response('', { status: 404 })
      return new Response(fs.readFileSync(wasmFile), { status: 200, headers: { 'Content-Type': 'application/wasm' } })
    })
    const d = await loadDetector()
    expect(d).not.toBeInstanceOf(PartialNative)

    // Silent Hill 2's black label.
    const found = await d.detect(upcImage('083717200253'))
    // ZXing may name a UPC-A as the EAN-13 it also is; both normalize to the index's 13 digits.
    expect(found).toHaveLength(1)
    expect(normalizeBarcode(found[0].rawValue, found[0].format)).toBe('0083717200253')
    expect(asked.some((u) => u.endsWith('.wasm'))).toBe(true)
    expect(asked.some((u) => /jsdelivr|unpkg/.test(u))).toBe(false)
  }, 20_000)
})

// barcode-detector loads the wasm of the zxing-wasm version it was built
// against; the site serves the one npm installed. A drift between the two
// breaks only the browsers that need the bundled reader (Safari on an iPhone),
// so it fails here instead.
describe('the bundled reader and the wasm the site serves', () => {
  it('are the same zxing-wasm version', async () => {
    const { ZXING_WASM_VERSION } = await import('barcode-detector/ponyfill')
    const installed = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../node_modules/zxing-wasm/package.json'), 'utf8')) as {
      version: string
    }
    expect(ZXING_WASM_VERSION).toBe(installed.version)
  })
})

describe('the camera in words', () => {
  it('says what to do for a refusal, a missing camera and a busy one', () => {
    expect(cameraProblem(new DOMException('', 'NotAllowedError'))).toMatch(/refused/i)
    expect(cameraProblem(new DOMException('', 'NotFoundError'))).toMatch(/no camera/i)
    expect(cameraProblem(new DOMException('', 'NotReadableError'))).toMatch(/busy/i)
  })

  it('offers a light only where the camera has one', () => {
    const track = (torch: boolean) => ({ getCapabilities: () => ({ torch }), applyConstraints: vi.fn(async () => {}) })
    const lit = track(true)
    expect(torchOf({ getVideoTracks: () => [lit] } as unknown as MediaStream)).not.toBeNull()
    expect(torchOf({ getVideoTracks: () => [track(false)] } as unknown as MediaStream)).toBeNull()
    expect(torchOf(null)).toBeNull()
  })
})
