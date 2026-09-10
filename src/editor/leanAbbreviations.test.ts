import { describe, expect, it } from 'vitest'
import { findLeanAbbreviation, leanAbbreviations } from './leanAbbreviations'

describe('findLeanAbbreviation', () => {
  it.each([
    ['f \\to ', 1, '→', 3, 6],
    ['\\forall ', 1, '∀', 1, 8],
    ['exact \\<> ', 1, '⟨⟩', 7, 10],
    ['x \\alpha', 0, 'α', 3, 9],
  ])('resolves %s', (prefix, triggerLength, replacement, startColumn, endColumn) => {
    expect(findLeanAbbreviation(prefix, triggerLength)).toMatchObject({
      replacement,
      startColumn,
      endColumn,
    })
  })

  it('forces the longest known prefix and preserves the remaining suffix', () => {
    expect(findLeanAbbreviation('\\for ', 1)).toMatchObject({ replacement: '∀' })
    expect(findLeanAbbreviation('\\unknown ', 1)).toMatchObject({ replacement: '∪known' })
  })

  it('uses Lean standard abbreviations beyond the common subset', () => {
    expect(Object.keys(leanAbbreviations).length).toBeGreaterThan(400)
    expect(leanAbbreviations['\\fun']).toBe('λ')
    expect(leanAbbreviations['\\bbR']).toBe('ℝ')
    expect(leanAbbreviations['\\sub']).toBe('⊆')
  })

  it('places the cursor inside paired delimiters', () => {
    expect(findLeanAbbreviation('\\<> ', 1)).toMatchObject({
      replacement: '⟨⟩',
      cursorOffset: 1,
    })
  })

  it('replaces the longest known prefix while preserving a suffix', () => {
    expect(findLeanAbbreviation('x \\alpha7 ', 1)).toMatchObject({
      replacement: 'α7',
      startColumn: 3,
      endColumn: 10,
    })
  })
})