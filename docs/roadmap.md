# LeanLander Roadmap

## Milestone 1: Application Shell

- [x] Tauri 2 application with React and TypeScript
- [x] Locally bundled Monaco editor
- [x] Basic Lean 4 syntax highlighting
- [x] Compact project, editor, proof-state, and status layout
- [x] Multiple sample files and tabs
- [x] Native project folder dialog behind a service interface
- [x] Cursor-driven sample proof state
- [x] Responsive narrow-window layout
- [x] Frontend behavior and path-handling tests

## Milestone 2: Project Discovery

- [x] Read project directories through narrowly scoped Tauri commands
- [x] Detect `lean-toolchain`, `lakefile.toml`, and `lakefile.lean`
- [x] Discover Lean source roots without full-project rescans
- [x] Load and save real files safely
- [x] Remember recent projects in the application data directory
- [x] Add Rust tests for spaces, Unicode, symlinks, and malformed configuration

## Milestone 3: Elan

- [x] Detect Elan without assuming `PATH`
- [x] Parse installed and active toolchains
- [x] Install a project-required toolchain with progress and cancellation
- [x] Present safe repair actions for missing components

## Milestone 4: Lean Language Server

- [x] Manage one Lean server process per workspace
- [x] Connect Monaco documents to LSP lifecycle events
- [x] Implement diagnostics, hover, completion, definitions, references, and symbols
- [x] Integrate Lean infoview RPC for real cursor-position proof states
- [x] Isolate differences between Lean versions behind a compatibility adapter

## Milestone 5: Lake And Project Creation

- [x] Create Lean and Lean + Mathlib projects
- [x] Optionally initialize Git
- [x] Fetch dependencies with progress and cancellation
- [x] Build projects and translate common failures

## Milestone 6: Lean Doctor

- [x] Diagnose Elan, Lean, Lake, toolchain, dependency, and server state
- [x] Offer explicit, safe repairs
- [x] Keep detailed logs available without exposing them by default

## Milestone 7: Release Readiness

- [x] Add Windows, macOS, and Linux CI builds
- [x] Publish version-tagged GitHub releases with checksums
- [x] Add signed application icons and installer metadata
- [x] Exercise accessibility and keyboard workflows
- [x] Add end-to-end tests with temporary Lean projects
- [x] Profile startup and editor memory use

## Trial by Fire: Proof Corpora

- [x] Pin and inspect OpenAI's Navier-Stokes and Euler formalization
- [x] Pin and inspect Anthropic's Fermat's Last Theorem formalization
- [x] Pin and inspect the PFR community formalization
- [x] Record deterministic source and proof-state walkthroughs
- [x] Publish optimized GIFs with source integrity checks and attribution

## v0.2 Outcomes

Milestones 1 through 7 recorded plumbing reached, not proving achieved. The following
outcomes are falsifiable from a cold machine and gate v0.2. Each milestone below serves
one of them.

- [ ] A newcomer proves `2 + 2 = 4` on a machine with no Lean tools in under two minutes
- [ ] A user types `∀ ε > 0, ∃ δ > 0` without leaving the keyboard
- [ ] A proof with three goals open after `induction` shows all three
- [ ] `#eval` and `#check` output is readable without hovering a squiggle
- [ ] A Mathlib contributor opens `Mathlib/Analysis/` and jumps to a definition in a dependency
- [ ] Returning to a previously opened tab does not wait for re-elaboration

## Milestone 8: Unicode Input And Keyboard Control

- [ ] Abbreviation input covering Lean's standard table, including `\to`, `\forall`, and `\<>`
- [ ] Resolve abbreviations on the same triggers as the Lean 4 VS Code extension
- [ ] Leave partially typed abbreviations recoverable and undoable as single edits
- [ ] Bind save, quick open, project search, and Doctor to platform-correct accelerators
- [ ] Cover abbreviation expansion and accelerators in the acceptance layer

## Milestone 9: Readable Proof State

- [ ] Decode every goal returned by `getInteractiveGoals`, not only the first
- [ ] Model goals as a list in the native proof state and render all of them
- [ ] Show goal case names and let the panel scroll without losing the first goal
- [ ] Add a messages pane listing diagnostics with severity, position, and full text
- [ ] Surface `#eval`, `#check`, and `trace` output in the messages pane
- [ ] Keep the plain-goal fallback path aligned with the multiple-goal model

## Milestone 10: Event-Driven Server Updates

- [ ] Emit cached `publishDiagnostics` to the webview as Tauri events
- [ ] Handle `$/lean/fileProgress` and show which regions are still elaborating
- [ ] Distinguish "no goals" from "not finished" in the proof panel
- [ ] Push Lake and toolchain progress as events
- [ ] Remove the diagnostic, proof-state, Lake, and toolchain polling intervals
- [ ] Leave the webview idle when no file is elaborating

## Milestone 11: Large Project Scale

- [ ] Return a path tree from project discovery without reading file contents
- [ ] Load source text only when a file is opened
- [ ] Render a collapsible directory tree with a name filter
- [ ] Open Mathlib without truncation warnings or unbounded memory growth
- [ ] Extend the performance profile to a Mathlib-scale project

## Milestone 12: Cross-File Navigation

- [ ] Open definition and reference targets in other project files
- [ ] Resolve targets inside `.lake/packages` and open them read-only
- [ ] Add project-wide source search
- [ ] Keep path validation strict while allowing read-only dependency roots

## Milestone 13: Document Session Reuse

- [ ] Keep opened documents synchronized after a tab switch
- [ ] Send incremental document changes instead of full text
- [ ] Retain diagnostics and proof state per document across switches
- [ ] Bound the number of concurrently open documents per workspace

## Milestone 14: Distribution Trust And Appearance

- [ ] Notarize macOS builds and sign Windows installers
- [ ] Remove unknown-publisher warnings from the install instructions
- [ ] Add a dark theme for the editor and application shell
- [ ] Follow the operating-system appearance preference by default
