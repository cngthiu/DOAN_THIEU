import { describe, expect, it } from 'vitest'

import { formatVideoTime } from './VideoPlayer'

describe('formatVideoTime', () => {
  it('formats minute and hour durations', () => {
    expect(formatVideoTime(0)).toBe('00:00')
    expect(formatVideoTime(125.8)).toBe('02:05')
    expect(formatVideoTime(3723)).toBe('01:02:03')
  })

  it('handles invalid timing values', () => {
    expect(formatVideoTime(Number.NaN)).toBe('00:00')
    expect(formatVideoTime(-1)).toBe('00:00')
  })
})
