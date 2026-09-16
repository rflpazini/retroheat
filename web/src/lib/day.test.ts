import { describe, expect, it } from 'vitest'
import { parseDay, today } from './day'

describe('parseDay', () => {
  it('reads a bare day, a written month and a slash date as the same day', () => {
    expect(parseDay('2024-10-08')).toBe('2024-10-08')
    expect(parseDay('Oct 8, 2024')).toBe('2024-10-08')
    expect(parseDay('8 Oct 2024')).toBe('2024-10-08')
    expect(parseDay('October 8, 2024')).toBe('2024-10-08')
    expect(parseDay(' 2024-10-08 ')).toBe('2024-10-08')
  })

  it('reads a slash date either way round when only one way is possible', () => {
    expect(parseDay('28/10/2024')).toBe('2024-10-28')
    expect(parseDay('10/28/2024')).toBe('2024-10-28')
    expect(parseDay('2024/10/28')).toBe('2024-10-28')
  })

  it('rejects a day that could be read two ways, one that does not exist, and words', () => {
    expect(parseDay('03/04/2024')).toBeNull()
    expect(parseDay('2024-02-30')).toBeNull()
    expect(parseDay('2024-13-01')).toBeNull()
    expect(parseDay('yesterday')).toBeNull()
    expect(parseDay('')).toBeNull()
    expect(parseDay('1899-12-31')).toBeNull()
  })
})

describe('today', () => {
  it('names the local day as a bare date', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(parseDay(today())).toBe(today())
  })
})
