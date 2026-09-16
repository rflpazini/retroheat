import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOnline, useUpdateReady } from './online'

describe('useOnline', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports what the browser says and follows the online and offline events', () => {
    const state = { onLine: true }
    vi.stubGlobal('navigator', { ...navigator, get onLine() { return state.onLine } })
    const { result } = renderHook(() => useOnline())
    expect(result.current).toBe(true)

    state.onLine = false
    act(() => window.dispatchEvent(new Event('offline')))
    expect(result.current).toBe(false)

    state.onLine = true
    act(() => window.dispatchEvent(new Event('online')))
    expect(result.current).toBe(true)
  })
})

describe('useUpdateReady', () => {
  it('is quiet until a new version announces itself, then hands over the way to apply it', () => {
    const { result } = renderHook(() => useUpdateReady())
    expect(result.current).toBeNull()

    const apply = vi.fn()
    act(() => window.dispatchEvent(new CustomEvent('retroheat:update-ready', { detail: { apply } })))
    expect(result.current).not.toBeNull()
    result.current!()
    expect(apply).toHaveBeenCalledOnce()
  })
})
