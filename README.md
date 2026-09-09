<p align="center">
  <img src="src/assets/leanlander-mark.svg" width="144" alt="LeanLander logo: a turnstile whose stem tapers to a blade point">
</p>

<h1 align="center">LeanLander</h1>

<p align="center"><strong>There can be only one... Lean IDE.</strong></p>

<p align="center">
  <img alt="Status: Milestone 1" src="https://img.shields.io/badge/status-milestone%201-68717d">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24c8db?logo=tauri&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-087ea4?logo=react&logoColor=white">
  <img alt="Tests passing" src="https://img.shields.io/badge/tests-passing-2389b8">
</p>

LeanLander is a focused, cross-platform desktop IDE for Lean 4. It aims to make opening a project and proving feel immediate, without asking users to become experts in Elan, Lake, or editor configuration first.

The project is currently at **Milestone 1**: a runnable Tauri shell, a React workspace, an offline Monaco editor with Lean syntax highlighting, file tabs, a native folder chooser, and a cursor-driven sample proof-state panel. The files and proof state are fixtures for now; selecting a folder does not execute or modify project code.

## Getting Started

Start from a local clone of this repository. All platforms require [Node.js](https://nodejs.org/) `^20.19.0` or `>=22.12.0`, npm, and [Rust via rustup](https://www.rust-lang.org/tools/install).

### Linux 🐧

On Debian or Ubuntu, this one command installs Tauri's native libraries, installs the locked JavaScript dependencies, and starts LeanLander:

```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev && npm ci && npm run tauri dev
```

For other distributions, use the equivalent packages from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

### macOS 🍎

Install Xcode and complete its first-launch setup, then run:

```bash
xcode-select -p >/dev/null && npm ci && npm run tauri dev
```

### Windows 🪟

Install Microsoft C++ Build Tools with **Desktop development with C++** and ensure WebView2 is available. From PowerShell, run:

```powershell
npm ci; if ($LASTEXITCODE -eq 0) { npm run tauri dev }
```

For a frontend-only preview on any platform, run `npm run dev` and open `http://localhost:1420`. The sample workspace works in a browser, but native folder selection does not.

Build an installable desktop bundle with `npm run tauri build`.

## Quality Checks

```bash
npm run check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
```

`npm run check` runs Oxlint, Vitest, TypeScript, and the Vite production build. `cargo check` requires the platform dependencies listed above.

## Structure

```text
src/
  components/       React workspace and editor panels
  editor/           Monaco and Lean language setup
  model/            UI-facing workspace and proof-state data
  services/         Frontend service boundaries
  test/             Shared frontend test setup
src-tauri/
  capabilities/     Tauri permission policy
  src/              Native application entry points
docs/
  architecture.md   System boundaries and integration strategy
  roadmap.md        Milestone status and next work
```

See [docs/architecture.md](docs/architecture.md) for design decisions and [docs/roadmap.md](docs/roadmap.md) for the implementation sequence.