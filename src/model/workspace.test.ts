import { describe, expect, it } from 'vitest'
import { proofStateAt } from './workspace'

describe('proofStateAt', () => {
  it('shows the induction hypothesis in the successor branch', () => {
    expect(proofStateAt('main', 8)).toEqual({
      declaration: 'LeanLander.add_zero · succ',
      goalCount: 1,
      hypotheses: [
        { name: 'n', type: 'Nat' },
        { name: 'ih', type: 'n + 0 = n' },
      ],
      target: 'Nat.succ n + 0 = Nat.succ n',
    })
  })

  it('shows the introduced hypothesis in the triangle proof', () => {
    expect(proofStateAt('arithmetic', 9)).toEqual({
      declaration: 'LeanLander.Arithmetic.triangle',
      goalCount: 1,
      hypotheses: [
        { name: 'a', type: 'ℝ' },
        { name: 'b', type: 'ℝ' },
        { name: 'h', type: 'a ≤ b' },
      ],
      target: 'a + a ≤ b + b',
    })
  })

  it('returns a clear state outside a proof', () => {
    expect(proofStateAt('main', 2)).toEqual({
      declaration: 'No active declaration',
      goalCount: 0,
      hypotheses: [],
    })
  })
})