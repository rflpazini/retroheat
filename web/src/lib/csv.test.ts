import { describe, expect, it } from 'vitest'
import { parseCSV, toCSV } from './csv'

describe('parseCSV', () => {
  it('reads quoted fields, embedded commas, doubled quotes and line breaks inside a field (RFC 4180)', () => {
    const text = 'a,b,c\r\n1,"two, with comma","say ""hi"""\r\n"multi\nline",,x\r\n'
    expect(parseCSV(text)).toEqual([
      ['a', 'b', 'c'],
      ['1', 'two, with comma', 'say "hi"'],
      ['multi\nline', '', 'x'],
    ])
  })

  it('accepts bare line feeds, a byte order mark and a missing final newline, and skips blank lines', () => {
    expect(parseCSV('﻿a,b\n1,2\n\n3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
    expect(parseCSV('')).toEqual([])
  })

  it('keeps a space after a comma, since exports differ on it', () => {
    expect(parseCSV('a, b\n1, 2')).toEqual([
      ['a', ' b'],
      ['1', ' 2'],
    ])
  })
})

describe('toCSV', () => {
  it('quotes a cell with a comma, a quote or a newline so it parses back', () => {
    const rows = [
      ['title', 'notes'],
      ['Bully', 'plain'],
      ['Okami', 'has, comma'],
      ['Rez', 'says "hi"'],
      ['Ico', 'two\nlines'],
    ]
    const text = toCSV(rows)
    expect(text).toBe('title,notes\r\nBully,plain\r\nOkami,"has, comma"\r\nRez,"says ""hi"""\r\nIco,"two\nlines"\r\n')
    expect(parseCSV(text)).toEqual(rows)
  })
})
