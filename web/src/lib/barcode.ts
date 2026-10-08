import type { Edition } from '@/lib/types'

/*
  The barcode on the back of a box, read into the one form the index uses:
  13 digits. A US box carries a 12-digit UPC-A, which an EAN-13 reader sees
  with a leading zero; European and Japanese boxes carry an EAN-13 already.
  Normalizing both sides the same way is what lets a scan meet the index, and
  the check digit is what tells a clean read from a smudged one.
*/

/** data/barcodes.json, written by the collector from the catalog's barcodes. */
export interface BarcodeIndexFile {
  as_of: string
  /** Keyed by 13 digits. */
  codes: Record<string, { id: string; variant?: Edition }>
}

export interface BarcodeHit {
  id: string
  /** The printing the code belongs to, when the catalog knows it is not the first one. */
  variant: Edition | null
}

/** True when the last digit is the GS1 check digit of the rest, as on every UPC and EAN. */
function checks(digits: string): boolean {
  let sum = 0
  for (let i = digits.length - 2, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) sum += Number(digits[i]) * weight
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1])
}

/**
 * The UPC-A a short UPC-E stands for. Small boxes print the eight-digit
 * form, which drops runs of zeros from the twelve-digit one; the last of its
 * six middle digits says where the zeros went.
 */
export function expandUPCE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const [n, d1, d2, d3, d4, d5, d6, check] = code
  let body: string
  if (d6 <= '2') body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`
  else if (d6 === '3') body = `${d1}${d2}${d3}00000${d4}${d5}`
  else if (d6 === '4') body = `${d1}${d2}${d3}${d4}00000${d5}`
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`
  return `${n}${body}${check}`
}

/**
 * The 13 digits a scanned or typed code stands for, or null when it is not a
 * product barcode or did not read cleanly. The format, when the detector
 * gives one, settles whether eight digits are a UPC-E.
 */
export function normalizeBarcode(raw: string, format?: string): string | null {
  const digits = raw.replace(/[\s-]/g, '')
  if (!/^\d+$/.test(digits)) return null
  let code: string | null
  switch (digits.length) {
    case 8: {
      if (format && format !== 'upc_e') return null
      const upca = expandUPCE(digits)
      code = upca ? `0${upca}` : null
      break
    }
    case 12:
      code = `0${digits}`
      break
    case 13:
      code = digits
      break
    case 14:
      code = digits.startsWith('0') ? digits.slice(1) : null
      break
    default:
      code = null
  }
  return code && checks(code) ? code : null
}

/** A code as it is printed under the bars: UPC-A in its 1-5-5-1 groups, EAN-13 in 1-6-6. */
export function formatBarcode(code: string): string {
  if (code.length !== 13) return code
  if (code.startsWith('0')) return `${code[1]} ${code.slice(2, 7)} ${code.slice(7, 12)} ${code[12]}`
  return `${code[0]} ${code.slice(1, 7)} ${code.slice(7)}`
}

/**
 * The game a normalized code belongs to. The reader's own pairings come
 * first: one made to correct the catalog should hold for them at once, while
 * the catalog's owner checks it before anyone else trusts it.
 */
export function lookupBarcode(code: string, index: BarcodeIndexFile | null, pairs: Map<string, string>): BarcodeHit | null {
  const yours = pairs.get(code)
  if (yours) return { id: yours, variant: null }
  const known = index?.codes[code]
  if (known) return { id: known.id, variant: known.variant ?? null }
  return null
}
