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

- [ ] Create Lean and Lean + Mathlib projects
- [ ] Optionally initialize Git
- [ ] Fetch dependencies with progress and cancellation
- [ ] Build projects and translate common failures

## Milestone 6: Lean Doctor

- [ ] Diagnose Elan, Lean, Lake, toolchain, dependency, and server state
- [ ] Offer explicit, safe repairs
- [ ] Keep detailed logs available without exposing them by default

## Milestone 7: Release Readiness

- [x] Add Windows, macOS, and Linux CI builds
- [x] Publish version-tagged GitHub releases with checksums
- [ ] Add signed application icons and installer metadata
- [ ] Exercise accessibility and keyboard workflows
- [ ] Add end-to-end tests with temporary Lean projects
- [ ] Profile startup and editor memory use