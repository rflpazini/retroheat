/*
  CSV as RFC 4180 spells it, and as the collection tools actually write it:
  quoted fields with doubled quotes, commas and line breaks inside quotes,
  CRLF or bare LF, a byte order mark from Excel, a missing final newline.
  Small enough to own; a dependency would be larger than the problem.
*/

/** Reads a CSV text into rows of cells. Blank lines are skipped; spaces are kept. */
export function parseCSV(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endRow = () => {
    row.push(field)
    field = ''
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') endRow()
    else if (ch === '\r') {
      if (s[i + 1] !== '\n') endRow()
    } else field += ch
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

function cell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** Writes rows as CSV with CRLF line ends, quoting only what needs it. */
export function toCSV(rows: string[][]): string {
  if (rows.length === 0) return ''
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
