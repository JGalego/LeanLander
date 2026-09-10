import { describe, expect, it } from 'vitest'
import { toLspPosition } from './leanLsp'

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
})