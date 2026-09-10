import { describe, expect, it, vi } from 'vitest'
import { openOrReturnLocations, toLspPosition } from './leanLsp'

describe('Lean Monaco adapter', () => {
  it('converts one-based Monaco positions to zero-based LSP positions', () => {
    expect(toLspPosition({ lineNumber: 7, column: 3 })).toEqual({
      line: 6,
      character: 2,
    })
  })

  it('clamps incomplete editor positions at the start of a document', () => {
    expect(toLspPosition({ lineNumber: 0, column: 0 })).toEqual({
      line: 0,
      character: 0,
    })
  })

  it('routes cross-file locations through the guarded workspace opener', () => {
    const openLocation = vi.fn()
    const range = {
      start: { line: 4, character: 2 },
      end: { line: 4, character: 8 },
    }

    const result = openOrReturnLocations(
      {} as never,
      { openLocation } as never,
      'file:///workspace/Main.lean',
      { uri: 'file:///workspace/Support.lean', range },
    )

    expect(result).toBeNull()
    expect(openLocation).toHaveBeenCalledWith('file:///workspace/Support.lean', range)
  })
})