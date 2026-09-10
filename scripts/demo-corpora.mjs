export const demoCorpora = [
  {
    id: 'openai-navier-stokes-euler',
    title: 'Navier-Stokes and Euler',
    organization: 'OpenAI',
    projectName: 'NavierStokesAndEuler',
    repository: 'https://github.com/openai/NavierStokesAndEuler',
    commit: '8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538',
    toolchain: 'leanprover/lean4:v4.34.0-rc2',
    lakefile: 'lakefile.toml',
    license: 'Apache-2.0',
    attributionFiles: ['LICENSE'],
    files: [
      {
        path: 'NavierStokes/ComparatorSolution.lean',
        focus: 'theorem navier_stokes_breakdown_R3',
        sha256: '52950d5d618a8d34c9bfbdb16641c81c276e97b6d7fd2a76c08577353f0b0227',
        proofState: {
          declaration: 'navier_stokes_breakdown_R3',
          goalCount: 1,
          hypotheses: [
            { name: 'nu', type: 'ℝ' },
            { name: 'hnu', type: 'nu > 0' },
          ],
          target: '∃ (u₀ : ℝ³ → ℝ³) (f : ℝ³ → ℝ → ℝ³), InitialVelocityConditionDecay u₀ ∧ ForceConditionDecay f ∧ ¬ (∃ v p, NavierStokesExistenceAndSmoothnessRn nu u₀ f v p)',
        },
      },
      {
        path: 'Euler/EulerSingularity.lean',
        focus: 'theorem exists_compact_smooth_euler_singularity',
        sha256: 'b31185500b05f5bfcdab0c7a442655af2b7aee44d4dcb10489ce0641fa614a2e',
        proofState: {
          declaration: 'exists_compact_smooth_euler_singularity',
          goalCount: 1,
          hypotheses: [],
          target: '∃ (A : SmoothL2Field Space) (L : FiniteLifespan A), ContDiff ℝ ∞ A.field ∧ HasCompactSupport A.field ∧ A.field ≠ 0 ∧ (∀ x, divergence A.field x = 0) ∧ 0 < L.duration ∧ L.duration ≤ 1 ∧ (∀ T : ℝ, HasScalarEulerEvolution A T ↔ 0 < T ∧ T < L.duration)',
        },
      },
    ],
  },
  {
    id: 'anthropic-fermats-last-theorem',
    title: "Fermat's Last Theorem",
    organization: 'Anthropic',
    projectName: 'FermatsLastTheorem',
    repository: 'https://github.com/anthropics/fermats-last-theorem',
    commit: 'aa2d8b34692b16c70f699536de0d8e75b9a3e9ef',
    toolchain: 'leanprover/lean4:v4.33.1',
    lakefile: 'lakefile.lean',
    license: 'Apache-2.0 with NOTICE and ATTRIBUTION.md',
    attributionFiles: ['LICENSE', 'NOTICE', 'ATTRIBUTION.md'],
    files: [
      {
        path: 'P2M/Sol/S_FLT_fermatLastTheorem.lean',
        focus: 'theorem solution',
        sha256: '3758e653dcc2fcac1c2b35b63ef1713ac68a0f0d99d163458dd30b7dce2c47c0',
        proofState: {
          declaration: 'solution',
          goalCount: 1,
          hypotheses: [],
          target: 'FermatLastTheorem',
        },
      },
      {
        path: 'Theorems/Thm_fermat_last_theorem.lean',
        focus: 'theorem fermat_last_theorem',
        sha256: 'b678bb152910351b3c968a1ae59829fe7bcde15157856d5740bf799bfd5127db',
        proofState: {
          declaration: 'fermat_last_theorem',
          goalCount: 1,
          hypotheses: [
            { name: 'n', type: 'ℕ' },
            { name: 'hn', type: '3 ≤ n' },
            { name: 'a b c', type: 'ℕ' },
            { name: 'ha hb hc', type: '0 < a, 0 < b, 0 < c' },
          ],
          target: 'a ^ n + b ^ n ≠ c ^ n',
        },
      },
    ],
  },
  {
    id: 'teorth-pfr',
    title: 'Polynomial Freiman-Ruzsa',
    organization: 'PFR community project',
    projectName: 'PFR',
    repository: 'https://github.com/teorth/pfr',
    commit: '3d7898164ebff70a809dce618f9082a7b39e7850',
    toolchain: 'leanprover/lean4:v4.34.0-rc2',
    lakefile: 'lakefile.toml',
    license: 'Apache-2.0',
    attributionFiles: ['LICENSE'],
    files: [
      {
        path: 'PFR/Examples.lean',
        focus: 'mod_cast PFR_conjecture h₀A hA',
        sha256: 'dbbc7c0ad73eca707d481304a236f6d9653bd58111244adc0540e998c12aa36f',
        proofState: {
          declaration: 'PFR example',
          goalCount: 1,
          hypotheses: [
            { name: 'A', type: 'Set G' },
            { name: 'K', type: 'ℝ' },
            { name: 'h₀A', type: 'A.Nonempty' },
            { name: 'hA', type: 'Nat.card (A + A) ≤ K * Nat.card A' },
          ],
          target: '∃ (H : Submodule (ZMod 2) G) (c : Set G), Nat.card c < 2 * K ^ 12 ∧ Nat.card H ≤ Nat.card A ∧ A ⊆ c + H',
        },
      },
      {
        path: 'PFR/Main.lean',
        focus: 'theorem PFR_conjecture',
        sha256: 'ca005f229d75aa7f319774c8e7559214c1fb773f86d35ae8e6c8d5ed13e48cbd',
        proofState: {
          declaration: 'PFR_conjecture',
          goalCount: 1,
          hypotheses: [
            { name: 'hA₀', type: 'A.Nonempty' },
            { name: 'hA', type: '(A + A).ncard ≤ K * A.ncard' },
          ],
          target: '∃ (H : Submodule (ZMod 2) G) (c : Set G), Nat.card c < 2 * K ^ 12 ∧ (H : Set G).ncard ≤ A.ncard ∧ A ⊆ c + H',
        },
      },
    ],
  },
  {
    id: 'dwrensha-chess',
    title: 'Chess in Lean 4',
    organization: 'David Renshaw',
    projectName: 'Chess',
    repository: 'https://github.com/dwrensha/Chess.lean',
    commit: '4f0c2887128b6c669509df8647fd8c98012e28af',
    toolchain: 'leanprover/lean4:v4.15.0',
    lakefile: 'lakefile.lean',
    license: 'Apache-2.0',
    attributionFiles: ['LICENSE'],
    files: [
      {
        path: 'Chess/Examples.lean',
        focus: 'theorem smothered_mate',
        sha256: 'f49d57e2dee5fc3e311e1af1614f47ca586c83a9be17a2b98614b15675458ce9',
        proofState: {
          declaration: 'smothered_mate',
          goalCount: 1,
          hypotheses: [],
          target: 'ForcedWin .white smotheredMatePosition',
        },
      },
      {
        path: 'Chess/Example218.lean',
        focus: 'theorem position_with_218_moves',
        sha256: 'd214aabece9a571ebb47ffee1f12196c31e07dcd53cf6970562ddf0f7e564485',
        proofState: {
          goals: Array.from({ length: 218 }, (_, index) => ({
            declaration: `move ${index + 1} of 218`,
            hypotheses: [],
            target: `ForcedWin .black (legalReply example_5 ${index + 1})`,
          })),
        },
      },
    ],
  },
]

export function rawSourceUrl(corpus, path) {
  return `${corpus.repository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${corpus.commit}/${path}`
}