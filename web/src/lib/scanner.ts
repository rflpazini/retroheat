/*
  What the scanner needs from the browser, behind one seam so tests can hand
  in a fake camera and a fake detector (jsdom has neither). Android's Chrome
  reads barcodes natively; Safari on an iPhone does not, so there the
  ZXing-C++ build is loaded, and its .wasm is served from this site rather
  than a CDN, so a scan works offline once it has worked once.
*/

/** The formats on a game box: UPC-A on US boxes, EAN-13 elsewhere, UPC-E on small ones. */
export const FORMATS = ['upc_a', 'ean_13', 'upc_e'] as const

export interface DetectedCode {
  rawValue: string
  format: string
}

/** The one method of the Barcode Detection API the scanner uses. */
export interface Detector {
  detect(source: ImageBitmapSource): Promise<DetectedCode[]>
}

export interface ScanDeps {
  /** Opens the rear camera; rejects with the browser's error when there is none or it was refused. */
  openCamera(): Promise<MediaStream>
  loadDetector(): Promise<Detector>
  /** A photo chosen from the library or just taken, as something a detector reads. */
  imageOf(file: File): Promise<ImageBitmapSource>
  /** Milliseconds between two looks at the video. */
  interval: number
  /** Milliseconds to wait for the person's own pairings before scanning starts without them. */
  pairsTimeout: number
}

type DetectorClass = {
  new (options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<readonly string[]>
}

/** The browser's own detector when it reads every box format, otherwise the bundled one. */
export async function loadDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: DetectorClass }).BarcodeDetector
  if (native) {
    try {
      const supported = await native.getSupportedFormats()
      if (FORMATS.every((f) => supported.includes(f))) return new native({ formats: [...FORMATS] })
    } catch {
      // A detector that cannot list its formats is no better than none.
    }
  }
  // The .wasm is served from zxing-wasm's own package, so it must be the
  // build barcode-detector was made against: both are pinned to exact
  // versions in package.json, and scanner.test.ts fails if they drift.
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmURL }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  prepareZXingModule({
    overrides: { locateFile: (file: string, prefix: string) => (file.endsWith('.wasm') ? wasmURL : prefix + file) },
  })
  return new BarcodeDetector({ formats: [...FORMATS] })
}

export const browserScanDeps: ScanDeps = {
  openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      return Promise.reject(new DOMException('This browser cannot open a camera here', 'NotSupportedError'))
    }
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    })
  },
  loadDetector,
  imageOf: (file) => createImageBitmap(file),
  interval: 150,
  pairsTimeout: 3000,
}

/** Why the camera did not open, in words the window can show. */
export function cameraProblem(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was refused. Allow it for this site in the browser settings, or type the number under the bars.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
    return 'No camera was found. Type the number under the bars, or choose a photo of them.'
  }
  if (name === 'NotReadableError') return 'The camera is busy in another app. Close it there, or type the number under the bars.'
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'The camera needs the secure (https) address of this site. Type the number under the bars instead.'
  }
  return 'This browser cannot open a camera here. Type the number under the bars, or choose a photo of them.'
}

/** Whether the camera can light the box, and the switch for it; Android's Chrome offers it, Safari does not. */
export function torchOf(stream: MediaStream | null): ((on: boolean) => Promise<void>) | null {
  const track = stream?.getVideoTracks()[0]
  const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean }
  if (!track || !caps.torch) return null
  return (on) => track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
}

/** Turns the camera off: every track, so the light beside the lens goes out. */
export function stopStream(stream: MediaStream | null) {
  for (const track of stream?.getTracks() ?? []) track.stop()
}

let audio: AudioContext | null = null

/** The short square-wave chirp of a till reading a code. Best effort: no sound where audio is unavailable or still locked. */
export function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    audio ??= new Ctx()
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'square'
    osc.frequency.value = 1760
    gain.gain.value = 0.04
    osc.connect(gain).connect(audio.destination)
    osc.start()
    osc.stop(audio.currentTime + 0.07)
  } catch {
    // No sound is fine; the window shows the read.
  }
  try {
    navigator.vibrate?.(40)
  } catch {
    // Not every phone vibrates for a web page.
  }
}
