import { describe, expect, it } from 'vitest'
import { expandUPCE, formatBarcode, lookupBarcode, normalizeBarcode, type BarcodeIndexFile } from './barcode'

const index: BarcodeIndexFile = {
  as_of: '2026-10-08T00:00:00Z',
  codes: {
    '0083717200253': { id: 'silent-hill-2-ps2' },
    '0083717200505': { id: 'silent-hill-2-ps2', variant: 'greatest-hits' },
  },
}

describe('reading a barcode off a box', () => {
  it('reads a UPC-A as the 13 digits an EAN-13 scanner sees, so both reads meet in the index', () => {
    // Silent Hill 2's black label, as printed under the bars and as eBay's catalog stores it.
    expect(normalizeBarcode('083717200253', 'upc_a')).toBe('0083717200253')
    expect(normalizeBarcode('0083717200253', 'ean_13')).toBe('0083717200253')
    expect(normalizeBarcode('0 83717 20025 3')).toBe('0083717200253')
  })

  it('keeps a European or Japanese EAN-13 as it is', () => {
    expect(normalizeBarcode('4901234567894', 'ean_13')).toBe('4901234567894')
  })

  it('refuses a misread: a wrong check digit, a wrong length, letters', () => {
    expect(normalizeBarcode('083717200254', 'upc_a')).toBeNull()
    expect(normalizeBarcode('08371720025')).toBeNull()
    expect(normalizeBarcode('ABC')).toBeNull()
    expect(normalizeBarcode('')).toBeNull()
  })

  it('expands the short UPC-E printed on small boxes into its UPC-A', () => {
    expect(expandUPCE('04252614')).toBe('042100005264')
    expect(expandUPCE('01234558')).toBe('012345000058')
    expect(normalizeBarcode('04252614', 'upc_e')).toBe('0042100005264')
    // Typed by hand with no format, eight digits are taken as a UPC-E too.
    expect(normalizeBarcode('04252614')).toBe('0042100005264')
    expect(normalizeBarcode('04252615', 'upc_e')).toBeNull()
  })

  it('accepts a GTIN-14 with its padding zero, the way some catalogs write a UPC', () => {
    expect(normalizeBarcode('00083717200253')).toBe('0083717200253')
  })

  it('prints a code the way it sits under the bars', () => {
    expect(formatBarcode('0083717200253')).toBe('0 83717 20025 3')
    expect(formatBarcode('4901234567894')).toBe('4 901234 567894')
  })
})

describe('finding the game a barcode belongs to', () => {
  it('finds the release and its edition in the catalog index', () => {
    expect(lookupBarcode('0083717200253', index, new Map())).toEqual({ id: 'silent-hill-2-ps2', variant: null })
    expect(lookupBarcode('0083717200505', index, new Map())).toEqual({
      id: 'silent-hill-2-ps2',
      variant: 'greatest-hits',
    })
  })

  it("prefers the reader's own pairing, so a correction holds for them before the catalog catches up", () => {
    const pairs = new Map([['0083717200253', 'silent-hill-3-ps2']])
    expect(lookupBarcode('0083717200253', index, pairs)).toEqual({ id: 'silent-hill-3-ps2', variant: null })
  })

  it('knows nothing of a code neither has, and copes with no index at all', () => {
    expect(lookupBarcode('4901234567894', index, new Map())).toBeNull()
    expect(lookupBarcode('0083717200253', null, new Map())).toBeNull()
  })
})
