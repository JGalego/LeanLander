# Proof Corpus Walkthroughs

These scripted sessions exercise LeanLander with source from four substantial Lean projects. Every recording fetches the listed files directly from an exact upstream commit, verifies their SHA-256 hashes, and then drives LeanLander through source navigation, proof-state inspection, Lean Doctor, and the project build boundary.

The recordings are deterministic browser acceptance fixtures. They display authentic pinned source, but their proof states and environment checks are scripted rather than responses from a live Lean server. They do not claim to rebuild the full upstream projects. Lean Doctor and the final status bar state this boundary inside every recording.

## OpenAI: Navier-Stokes and Euler

![LeanLander navigating OpenAI's Navier-Stokes and Euler formalization](assets/demos/openai-navier-stokes-euler.gif)

- Repository: [openai/NavierStokesAndEuler](https://github.com/openai/NavierStokesAndEuler)
- Commit: [`8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538`](https://github.com/openai/NavierStokesAndEuler/tree/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538)
- Lean toolchain: `leanprover/lean4:v4.34.0-rc2`
- Scenes: [`NavierStokes/ComparatorSolution.lean`](https://github.com/openai/NavierStokesAndEuler/blob/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538/NavierStokes/ComparatorSolution.lean) and [`Euler/EulerSingularity.lean`](https://github.com/openai/NavierStokesAndEuler/blob/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538/Euler/EulerSingularity.lean)
- License: [Apache-2.0](https://github.com/openai/NavierStokesAndEuler/blob/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538/LICENSE)

The session moves from the reference Navier-Stokes breakdown adapter to the existential Euler singularity endpoint, including the compact-support, finite-lifespan, and vorticity conclusions.

## Anthropic: Fermat's Last Theorem

![LeanLander navigating Anthropic's Fermat's Last Theorem formalization](assets/demos/anthropic-fermats-last-theorem.gif)

- Repository: [anthropics/fermats-last-theorem](https://github.com/anthropics/fermats-last-theorem)
- Commit: [`aa2d8b34692b16c70f699536de0d8e75b9a3e9ef`](https://github.com/anthropics/fermats-last-theorem/tree/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef)
- Lean toolchain: `leanprover/lean4:v4.33.1`
- Scenes: [`P2M/Sol/S_FLT_fermatLastTheorem.lean`](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/P2M/Sol/S_FLT_fermatLastTheorem.lean) and [`Theorems/Thm_fermat_last_theorem.lean`](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/Theorems/Thm_fermat_last_theorem.lean)
- License and required notices: [Apache-2.0](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/LICENSE), [NOTICE](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/NOTICE), and [ATTRIBUTION.md](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/ATTRIBUTION.md)

The session shows the readable odd-prime split that closes `FermatLastTheorem`, then follows the generated P2M bridge to the familiar natural-number statement.

## PFR Community Project

![LeanLander navigating the Polynomial Freiman-Ruzsa formalization](assets/demos/teorth-pfr.gif)

- Repository: [teorth/pfr](https://github.com/teorth/pfr)
- Commit: [`3d7898164ebff70a809dce618f9082a7b39e7850`](https://github.com/teorth/pfr/tree/3d7898164ebff70a809dce618f9082a7b39e7850)
- Lean toolchain: `leanprover/lean4:v4.34.0-rc2`
- Scenes: [`PFR/Examples.lean`](https://github.com/teorth/pfr/blob/3d7898164ebff70a809dce618f9082a7b39e7850/PFR/Examples.lean) and [`PFR/Main.lean`](https://github.com/teorth/pfr/blob/3d7898164ebff70a809dce618f9082a7b39e7850/PFR/Main.lean)
- License: [Apache-2.0](https://github.com/teorth/pfr/blob/3d7898164ebff70a809dce618f9082a7b39e7850/LICENSE)

The session starts with the self-contained Mathlib-facing statement and then opens the headline covering proof, where a small-doubling set is covered by fewer than `2 * K ^ 12` cosets.

## Chess.lean

![LeanLander navigating Chess.lean](assets/demos/dwrensha-chess.gif)

- Repository: [dwrensha/Chess.lean](https://github.com/dwrensha/Chess.lean)
- Commit: [`4f0c2887128b6c669509df8647fd8c98012e28af`](https://github.com/dwrensha/Chess.lean/tree/4f0c2887128b6c669509df8647fd8c98012e28af)
- Lean toolchain: `leanprover/lean4:v4.15.0`
- Scenes: [`Chess/Examples.lean`](https://github.com/dwrensha/Chess.lean/blob/4f0c2887128b6c669509df8647fd8c98012e28af/Chess/Examples.lean) and [`Chess/Example218.lean`](https://github.com/dwrensha/Chess.lean/blob/4f0c2887128b6c669509df8647fd8c98012e28af/Chess/Example218.lean)
- License: [Apache-2.0](https://github.com/dwrensha/Chess.lean/blob/4f0c2887128b6c669509df8647fd8c98012e28af/LICENSE)

The project was built locally with its pinned Lean 4.15.0 toolchain and Mathlib 4.15.0 dependency before recording. The walkthrough opens the Unicode chessboard for `smothered_mate`, follows its chess-specific tactic script, and then visits the 218-legal-move stress example. As with the other recordings, the displayed source is authentic and integrity-checked while the proof-state panel is deterministic fixture data.

## Reproducing the Recordings

Install the locked JavaScript dependencies, Chromium, and `ffmpeg`, then run:

```bash
npm ci
npm run e2e:install
npm run demos:verify
npm run demos:record
```

`npm run demos:verify` performs only the source fetch, marker, and SHA-256 checks. `npm run demos:record` starts a temporary Vite server, records isolated Chromium contexts at 1280×720, and writes optimized 960×540 GIFs to `docs/assets/demos/`. The pinned manifest and proof-state fixtures live in [`scripts/demo-corpora.mjs`](../scripts/demo-corpora.mjs).

Copyright in the upstream projects and source remains with their respective contributors. The recordings use that source under the licenses linked above; LeanLander does not vendor the selected source files.