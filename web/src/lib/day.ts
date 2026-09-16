/*
  Days, as bare YYYY-MM-DD strings. A copy's purchase or sale is a day, not
  an instant, and a bare day survives formatDate without shifting west of
  Greenwich, which a full timestamp does not.
*/

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const pad = (n: number) => String(n).padStart(2, '0')

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`
}

function month(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1
}

/** A day that exists, in the years a game could have been bought. */
function valid(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/**
 * Reads a day someone typed or an export wrote: 2024-10-08, Oct 8, 2024,
 * 8 Oct 2024, or a slash date. A slash date is read the only way it can be;
 * one that reads two ways (03/04/2024) is refused rather than guessed.
 */
export function parseDay(text: string): string | null {
  const s = text.trim()
  let m: RegExpMatchArray | null
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]]
    return valid(y, mo, d) ? iso(y, mo, d) : null
  }
  if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) {
    const [a, b, y] = [+m[1], +m[2], +m[3]]
    let mo: number, d: number
    if (a > 12 && b <= 12) [d, mo] = [a, b]
    else if (b > 12 && a <= 12) [mo, d] = [a, b]
    else return null
    return valid(y, mo, d) ? iso(y, mo, d) : null
  }
  if ((m = s.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i))) {
    const [mo, d, y] = [month(m[1]), +m[2], +m[3]]
    return valid(y, mo, d) ? iso(y, mo, d) : null
  }
  if ((m = s.match(/^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i))) {
    const [d, mo, y] = [+m[1], month(m[2]), +m[3]]
    return valid(y, mo, d) ? iso(y, mo, d) : null
  }
  return null
}

/** The local day, for a sale recorded as it happens. */
export function today(now: Date = new Date()): string {
  return iso(now.getFullYear(), now.getMonth() + 1, now.getDate())
}
