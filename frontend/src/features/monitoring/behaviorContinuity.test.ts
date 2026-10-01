import { describe, expect, it } from 'vitest'
import { cheatStateAt } from './TrackingCanvas'
import { TrackingBuffer } from './trackingBuffer'
import type { CheatActorState, TrackingTrack } from './types'

describe('behavior continuity', () => {
  const track = { actor_id: 'A1' } as TrackingTrack
  const state = { actor_id: 'A1', timestamp_ms: 1000, alert: true, label: 'interaction' } as CheatActorState
  it('holds a prediction between inferences, accepts normal and expires stale state', () => {
    const states = new Map([['A1', state]])
    for (let timestamp = 1000; timestamp < 2000; timestamp += 40) {
      expect(cheatStateAt(states, track, timestamp)?.label).toBe('interaction')
    }
    states.set('A1', { ...state, timestamp_ms: 2000, alert: false, label: 'normal' })
    expect(cheatStateAt(states, track, 2040)?.label).toBe('normal')
    expect(cheatStateAt(states, track, 4601)).toBeNull()
  })
  it('rejects predictions from retired runtimes and earlier seek generations', () => {
    const buffer = new TrackingBuffer()
    buffer.activateRuntime('first', 0)
    expect(buffer.matchesRuntime('first', 0)).toBe(true)
    buffer.activateRuntime('first', 1)
    expect(buffer.matchesRuntime('first', 0)).toBe(false)
    buffer.activateRuntime('second', 0)
    expect(buffer.matchesRuntime('first', 1)).toBe(false)
    expect(buffer.matchesRuntime('second', 0)).toBe(true)
  })
})
