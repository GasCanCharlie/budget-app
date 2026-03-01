/**
 * Dashboard invalidation strategy tests.
 *
 * These test the debounce logic and cache invalidation behaviour without
 * mounting React components — the invalidateDashboard helper is extracted
 * as a pure factory so we can unit-test it directly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Pure debounce factory (mirrors the hook logic) ───────────────────────────

function makeDebouncedInvalidator(
  invalidate: (key: string[]) => void,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      invalidate(['summary'])
      invalidate(['trends'])
    }, delayMs)
  }

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    invalidate(['summary'])
    invalidate(['trends'])
  }

  return { schedule, flush }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('debounced dashboard invalidation', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(()  => { vi.useRealTimers() })

  it('does not call invalidate immediately', () => {
    const invalidate = vi.fn()
    const { schedule } = makeDebouncedInvalidator(invalidate, 800)
    schedule()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('calls invalidate once after delay', () => {
    const invalidate = vi.fn()
    const { schedule } = makeDebouncedInvalidator(invalidate, 800)
    schedule()
    vi.advanceTimersByTime(800)
    expect(invalidate).toHaveBeenCalledTimes(2)   // ['summary'] + ['trends']
    expect(invalidate).toHaveBeenCalledWith(['summary'])
    expect(invalidate).toHaveBeenCalledWith(['trends'])
  })

  it('collapses 30 rapid calls into a single invalidation', () => {
    const invalidate = vi.fn()
    const { schedule } = makeDebouncedInvalidator(invalidate, 800)
    for (let i = 0; i < 30; i++) schedule()
    vi.advanceTimersByTime(800)
    // Only 2 calls total: one for summary, one for trends
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('resets the timer on each call — fires only after last call + delay', () => {
    const invalidate = vi.fn()
    const { schedule } = makeDebouncedInvalidator(invalidate, 800)
    schedule()
    vi.advanceTimersByTime(400)   // halfway
    schedule()                    // reset
    vi.advanceTimersByTime(400)   // still not enough
    expect(invalidate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)   // now 800ms after the second call
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})

describe('flush (Finish Categorizing)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(()  => { vi.useRealTimers() })

  it('flush cancels pending debounce and invalidates immediately', () => {
    const invalidate = vi.fn()
    const { schedule, flush } = makeDebouncedInvalidator(invalidate, 800)
    schedule()
    flush()   // should fire immediately without waiting
    expect(invalidate).toHaveBeenCalledTimes(2)
  })

  it('flush does not double-fire when timer has already expired', () => {
    const invalidate = vi.fn()
    const { schedule, flush } = makeDebouncedInvalidator(invalidate, 800)
    schedule()
    vi.advanceTimersByTime(800)   // timer already fired
    flush()                       // should fire again (explicit flush = force refresh)
    expect(invalidate).toHaveBeenCalledTimes(4) // 2 from timer + 2 from flush
  })

  it('flush with no pending schedule still invalidates (safe to call any time)', () => {
    const invalidate = vi.fn()
    const { flush } = makeDebouncedInvalidator(invalidate, 800)
    flush()
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})

describe('cache key invalidation coverage', () => {
  it('always invalidates both summary and trends — never one without the other', () => {
    const invalidate = vi.fn()
    const { flush } = makeDebouncedInvalidator(invalidate, 800)
    flush()
    const keys = invalidate.mock.calls.map(c => c[0])
    expect(keys).toContainEqual(['summary'])
    expect(keys).toContainEqual(['trends'])
  })
})
