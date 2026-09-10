export interface WorkspaceFile {
  id: string
  name: string
  path: string
  content: string
  loaded?: boolean
  readOnly?: boolean
}

export interface Workspace {
  name: string
  path: string
  files: WorkspaceFile[]
}

export interface Hypothesis {
  name: string
  type: string
}

export interface ProofGoal {
  declaration: string
  hypotheses: Hypothesis[]
  target: string
}

export interface ProofState {
  goals?: ProofGoal[]
  declaration?: string
  goalCount?: number
  hypotheses?: Hypothesis[]
  target?: string
}

export function proofGoals(state: ProofState): ProofGoal[] {
  if (state.goals) {
    return state.goals
  }
  if (!state.target || (state.goalCount ?? 0) === 0) {
    return []
  }
  return [{
    declaration: state.declaration ?? 'Active proof',
    hypotheses: state.hypotheses ?? [],
    target: state.target,
  }]
}

export const sampleWorkspace: Workspace = {
  name: 'FirstProof',
  path: '~/LeanLander/FirstProof',
  files: [
    {
      id: 'main',
      name: 'Main.lean',
      path: 'Main.lean',
      content: `import Mathlib

namespace LeanLander

theorem add_zero (n : Nat) : n + 0 = n := by
  induction n with
  | zero => rfl
  | succ n ih =>
      simp [ih]

theorem add_comm (m n : Nat) : m + n = n + m := by
  omega

end LeanLander
`,
    },
    {
      id: 'arithmetic',
      name: 'Arithmetic.lean',
      path: 'LeanLander/Arithmetic.lean',
      content: `import Mathlib

namespace LeanLander.Arithmetic

theorem square_nonnegative (x : ℝ) : 0 ≤ x ^ 2 := by
  positivity

theorem triangle (a b : ℝ) : a ≤ b → a + a ≤ b + b := by
  intro h
  linarith

end LeanLander.Arithmetic
`,
    },
    {
      id: 'lists',
      name: 'Lists.lean',
      path: 'LeanLander/Lists.lean',
      content: `import Mathlib

namespace LeanLander.Lists

theorem reverse_reverse (items : List α) :
    items.reverse.reverse = items := by
  simpa using List.reverse_reverse items

end LeanLander.Lists
`,
    },
  ],
}

const emptyProofState: ProofState = {
  declaration: 'No active declaration',
  goalCount: 0,
  hypotheses: [],
}

export function proofStateAt(fileId: string, lineNumber: number): ProofState {
  if (fileId === 'main' && lineNumber >= 5 && lineNumber <= 9) {
    if (lineNumber === 7) {
      return {
        declaration: 'LeanLander.add_zero · zero',
        goalCount: 1,
        hypotheses: [],
        target: '0 + 0 = 0',
      }
    }

    if (lineNumber >= 8) {
      return {
        declaration: 'LeanLander.add_zero · succ',
        goalCount: 1,
        hypotheses: [
          { name: 'n', type: 'Nat' },
          { name: 'ih', type: 'n + 0 = n' },
        ],
        target: 'Nat.succ n + 0 = Nat.succ n',
      }
    }

    return {
      declaration: 'LeanLander.add_zero',
      goalCount: 1,
      hypotheses: [{ name: 'n', type: 'Nat' }],
      target: 'n + 0 = n',
    }
  }

  if (fileId === 'main' && lineNumber >= 11 && lineNumber <= 12) {
    return {
      declaration: 'LeanLander.add_comm',
      goalCount: 1,
      hypotheses: [
        { name: 'm', type: 'Nat' },
        { name: 'n', type: 'Nat' },
      ],
      target: 'm + n = n + m',
    }
  }

  if (fileId === 'arithmetic' && lineNumber >= 5 && lineNumber <= 6) {
    return {
      declaration: 'LeanLander.Arithmetic.square_nonnegative',
      goalCount: 1,
      hypotheses: [{ name: 'x', type: 'ℝ' }],
      target: '0 ≤ x ^ 2',
    }
  }

  if (fileId === 'arithmetic' && lineNumber >= 8 && lineNumber <= 10) {
    const hypotheses = [
      { name: 'a', type: 'ℝ' },
      { name: 'b', type: 'ℝ' },
    ]

    return {
      declaration: 'LeanLander.Arithmetic.triangle',
      goalCount: 1,
      hypotheses:
        lineNumber >= 9
          ? [...hypotheses, { name: 'h', type: 'a ≤ b' }]
          : hypotheses,
      target:
        lineNumber >= 9
          ? 'a + a ≤ b + b'
          : 'a ≤ b → a + a ≤ b + b',
    }
  }

  if (fileId === 'lists' && lineNumber >= 5 && lineNumber <= 7) {
    return {
      declaration: 'LeanLander.Lists.reverse_reverse',
      goalCount: 1,
      hypotheses: [
        { name: 'α', type: 'Type u_1' },
        { name: 'items', type: 'List α' },
      ],
      target: 'items.reverse.reverse = items',
    }
  }

  return emptyProofState
}