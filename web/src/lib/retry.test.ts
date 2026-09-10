import { describe, expect, it, vi } from 'vitest'
import { isClockSkew, retryOnClockSkew, skewMessage } from './retry'

describe('retrying a request the database refused for clock skew', () => {
  it('recognises PostgREST\'s "issued at future" refusal by code or by message', () => {
    expect(isClockSkew({ code: 'PGRST303', message: 'JWT issued at future' })).toBe(true)
    expect(isClockSkew({ message: 'JWT issued at future' })).toBe(true)
    expect(isClockSkew({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
    expect(isClockSkew(null)).toBe(false)
  })

  it('retries with a pause until the token is old enough, then returns the good result', async () => {
    vi.useFakeTimers()
    let calls = 0
    const run = vi.fn(async () => {
      calls++
      return calls < 3 ? { data: null, error: { code: 'PGRST303', message: 'JWT issued at future' } } : { data: 'ok', error: null }
    })
    const promise = retryOnClockSkew(run)
    await vi.runAllTimersAsync()
    expect(await promise).toEqual({ data: 'ok', error: null })
    expect(calls).toBe(3)
    vi.useRealTimers()
  })

  it('gives up after the retries and hands back the last error', async () => {
    vi.useFakeTimers()
    const run = vi.fn(async () => ({ data: null, error: { code: 'PGRST303', message: 'JWT issued at future' } }))
    const promise = retryOnClockSkew(run)
    await vi.runAllTimersAsync()
    const result = await promise
    expect(result.error?.code).toBe('PGRST303')
    expect(run).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('does not retry other errors, or successes', async () => {
    const other = vi.fn(async () => ({ data: null, error: { code: '42501', message: 'permission denied' } }))
    expect((await retryOnClockSkew(other)).error?.code).toBe('42501')
    expect(other).toHaveBeenCalledTimes(1)
    const fine = vi.fn(async () => ({ data: 1, error: null }))
    expect((await retryOnClockSkew(fine)).data).toBe(1)
    expect(fine).toHaveBeenCalledTimes(1)
  })

  it('explains the refusal in plain words and keeps the original text', () => {
    expect(skewMessage({ code: 'PGRST303', message: 'JWT issued at future' })).toMatch(/clock/i)
    expect(skewMessage({ code: 'PGRST303', message: 'JWT issued at future' })).toContain('JWT issued at future')
    expect(skewMessage({ message: 'permission denied' })).toBe('permission denied')
  })
})
