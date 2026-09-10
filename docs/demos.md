# Proof Corpus Walkthroughs

The recordings shown in the [README](../README.md#proof-corpus-walkthroughs) exercise LeanLander with four substantial Lean proof corpora and one interactive ProofWidgets scene. The corpus recordings fetch the listed files directly from exact upstream commits and verify their SHA-256 hashes. The Go-Lean recording uses a LeanLander-authored scratch file and loads the widget module from a local checkout because its upstream repository does not declare a source license.

The recordings are deterministic browser acceptance fixtures. They display authentic pinned source, but their proof states and environment checks are scripted rather than responses from a live Lean server. They do not claim to rebuild the full upstream projects. Lean Doctor and the final status bar state this boundary inside every recording.

## OpenAI: Navier-Stokes and Euler

- Repository: [openai/NavierStokesAndEuler](https://github.com/openai/NavierStokesAndEuler)
- Commit: [`8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538`](https://github.com/openai/NavierStokesAndEuler/tree/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538)
- Lean toolchain: `leanprover/lean4:v4.34.0-rc2`
- Scenes: [`NavierStokes/ComparatorSolution.lean`](https://github.com/openai/NavierStokesAndEuler/blob/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538/NavierStokes/ComparatorSolution.lean) and [`Euler/EulerSingularity.lean`](https://github.com/openai/NavierStokesAndEuler/blob/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538/Euler/EulerSingularity.lean)
- License: [Apache-2.0](https://github.com/openai/NavierStokesAndEuler/blob/8937a8f4cbc7abaab5e9e97d1cc7f5d2319d9538/LICENSE)

The session moves from the reference Navier-Stokes breakdown adapter to the existential Euler singularity endpoint, including the compact-support, finite-lifespan, and vorticity conclusions.

## Anthropic: Fermat's Last Theorem

- Repository: [anthropics/fermats-last-theorem](https://github.com/anthropics/fermats-last-theorem)
- Commit: [`aa2d8b34692b16c70f699536de0d8e75b9a3e9ef`](https://github.com/anthropics/fermats-last-theorem/tree/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef)
- Lean toolchain: `leanprover/lean4:v4.33.1`
- Scenes: [`P2M/Sol/S_FLT_fermatLastTheorem.lean`](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/P2M/Sol/S_FLT_fermatLastTheorem.lean) and [`Theorems/Thm_fermat_last_theorem.lean`](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/Theorems/Thm_fermat_last_theorem.lean)
- License and required notices: [Apache-2.0](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/LICENSE), [NOTICE](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/NOTICE), and [ATTRIBUTION.md](https://github.com/anthropics/fermats-last-theorem/blob/aa2d8b34692b16c70f699536de0d8e75b9a3e9ef/ATTRIBUTION.md)

The session shows the readable odd-prime split that closes `FermatLastTheorem`, then follows the generated P2M bridge to the familiar natural-number statement.

## PFR Community Project

- Repository: [teorth/pfr](https://github.com/teorth/pfr)
- Commit: [`3d7898164ebff70a809dce618f9082a7b39e7850`](https://github.com/teorth/pfr/tree/3d7898164ebff70a809dce618f9082a7b39e7850)
- Lean toolchain: `leanprover/lean4:v4.34.0-rc2`
- Scenes: [`PFR/Examples.lean`](https://github.com/teorth/pfr/blob/3d7898164ebff70a809dce618f9082a7b39e7850/PFR/Examples.lean) and [`PFR/Main.lean`](https://github.com/teorth/pfr/blob/3d7898164ebff70a809dce618f9082a7b39e7850/PFR/Main.lean)
- License: [Apache-2.0](https://github.com/teorth/pfr/blob/3d7898164ebff70a809dce618f9082a7b39e7850/LICENSE)

The session starts with the self-contained Mathlib-facing statement and then opens the headline covering proof, where a small-doubling set is covered by fewer than `2 * K ^ 12` cosets.

## Chess.lean

- Repository: [dwrensha/Chess.lean](https://github.com/dwrensha/Chess.lean)
- Commit: [`4f0c2887128b6c669509df8647fd8c98012e28af`](https://github.com/dwrensha/Chess.lean/tree/4f0c2887128b6c669509df8647fd8c98012e28af)
- Lean toolchain: `leanprover/lean4:v4.15.0`
- Scenes: [`Chess/Examples.lean`](https://github.com/dwrensha/Chess.lean/blob/4f0c2887128b6c669509df8647fd8c98012e28af/Chess/Examples.lean) and [`Chess/Example218.lean`](https://github.com/dwrensha/Chess.lean/blob/4f0c2887128b6c669509df8647fd8c98012e28af/Chess/Example218.lean)
- License: [Apache-2.0](https://github.com/dwrensha/Chess.lean/blob/4f0c2887128b6c669509df8647fd8c98012e28af/LICENSE)

The project was built locally with its pinned Lean 4.15.0 toolchain and Mathlib 4.15.0 dependency before recording. The walkthrough opens the Unicode chessboard for `smothered_mate`, follows its chess-specific tactic script, and then visits the 218-legal-move stress example. As with the other recordings, the displayed source is authentic and integrity-checked while the proof-state panel is deterministic fixture data.

## Go-Lean ProofWidgets

- Repository: [Mal-Pat/Go-Lean](https://github.com/Mal-Pat/Go-Lean)
- Commit: [`9cbb6c1ba771c9bdc0bad929db55bc70ea2c0c3f`](https://github.com/Mal-Pat/Go-Lean/tree/9cbb6c1ba771c9bdc0bad929db55bc70ea2c0c3f)
- Lean toolchain: `leanprover/lean4:v4.34.0-rc1`
- Scene: `LeanLanderDemo.lean`, authored by LeanLander for this recording
- Historical record: [AlphaGo vs Lee Sedol, game 2](https://github.com/akitaonrails/frank_go/blob/main/data/games/famous/2016-alphago-lee-sedol-game-2.sgf)
- Upstream license: none declared at the pinned commit; no Go-Lean source is reproduced in the recording

The pinned project passed `lake build` and `lake build Tests`, and the scratch scene passed `lake env lean LeanLanderDemo.lean`. The scene imports `GoLean`, loads the authentic game-two position after Lee Sedol's move 36, renders Go-Lean's actual JavaScript widget in LeanLander's sandboxed infoview, exits review mode, and plays AlphaGo's famous black move 37 at P10 on the 19×19 board.

The recording loads the real widget module but uses deterministic snapshots of the `GoLean.update` responses so it can be reproduced in Chromium. A separate opt-in native test discovers the widget through a real Lean server, fetches its source through `Lean.Widget.getWidgetSource`, calls `GoLean.update`, and verifies that Lean returns the board view.

## Reproducing the Recordings

Install the locked JavaScript dependencies, Chromium, and `ffmpeg`, then run:

```bash
npm ci
npm run e2e:install
npm run demos:verify
LEANLANDER_WIDGET_PROJECT=/path/to/Go-Lean npm run demos:record
```

`npm run demos:verify` performs only the source fetch, marker, and SHA-256 checks. `npm run demos:record` starts a temporary Vite server, records isolated Chromium contexts at 1280×720, and writes optimized 960×540 GIFs to `docs/assets/demos/`. `LEANLANDER_WIDGET_PROJECT` is required only when recording Go-Lean and must point to the pinned local checkout. The pinned manifest and proof-state fixtures live in [`scripts/demo-corpora.mjs`](../scripts/demo-corpora.mjs).

Copyright in the upstream projects and source remains with their respective contributors. The recordings use that source under the licenses linked above; LeanLander does not vendor the selected source files.