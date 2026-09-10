# LeanLander Architecture

## Direction

LeanLander is an orchestration layer around Lean's existing ecosystem. React owns presentation, Rust owns trusted operating-system and process work, and Lean, Elan, and Lake retain authority over language semantics, toolchains, and packages.

```mermaid
flowchart LR
  UI[React workspace] --> Services[Frontend service interfaces]
  Services --> Commands[Tauri commands]
  Commands --> Project[Project service]
  Commands --> Toolchain[Elan service]
  Commands --> Build[Lake service]
  Commands --> Server[Lean server manager]
  Server <--> LSP[Lean LSP and infoview RPC]
```

No UI component should construct a shell command. Native operations accept structured input, validate it, and use Rust process APIs with explicit executable and argument arrays.

## Current Boundary

Narrowly scoped Rust commands own project discovery, source loading and saving, recent-project history, Elan operations, and Lean server communication. Frontend clients own structured `invoke` calls, while `ProjectGateway` isolates the native folder dialog. Browser mode keeps the deterministic sample workspace active without claiming native services are available.

Project discovery performs one bounded scan, ignores generated and dependency directories, and never follows symlinks. Later reads and writes accept only existing relative `.lean` paths whose canonical targets remain inside the selected project. Recent paths are stored in Tauri's application data directory.

The Tauri capability grants `dialog:allow-open` only. Filesystem access remains behind validated Rust commands; there is no shell plugin, broad filesystem scope, or process capability exposed to the webview. Monaco and both fonts are packaged locally, so the editor does not fetch runtime assets from a CDN.

For a real project, Monaco documents are synchronized with a managed Lean process using full-text, monotonically versioned LSP updates. Diagnostics become Monaco markers, and hover, completion, definition, references, and document symbols use Monaco providers backed by standard LSP requests. The proof panel uses Lean's infoview RPC at the current cursor position. Only the bundled sample uses fixture proof data.

## Native Services

### Project service

Project discovery inspects a selected directory for `lean-toolchain`, `lakefile.toml`, `lakefile.lean`, and Lean sources. It returns structured facts and warnings before offering any modifying action. LeanLander does not introduce a proprietary project format.

### Toolchain service

The toolchain service discovers Elan through `ELAN_HOME`, platform-aware default locations, and finally `PATH`. It parses installed and active toolchains independently because an active default may not be installed yet. Project-required installations require an explicit user action, invoke Elan with a validated argument array, expose structured progress, and retain a managed child-process handle for cancellation.

When Elan is absent, LeanLander presents manual installation guidance rather than downloading and executing a script. Browser previews report native tools as unavailable instead of implying that a background check is pending.

### Lake and build service

Lake remains the package and build authority. LeanLander will invoke known Lake operations directly, capture stdout and stderr separately, and translate common failures into actionable messages. Arbitrary project-provided commands will not run silently.

### Lean server manager

One long-lived server process is owned per open workspace. The manager launches the project-selected Lean server through Elan, speaks framed JSON-RPC over stdio, routes document lifecycle events, answers server-to-client configuration requests, caches diagnostics by URI, and stops the process when its workspace closes.

Diagnostics, hover, completion, definitions, references, and symbols use standard LSP messages. Proof state connects to Lean's existing infoview session and calls `Lean.Widget.getInteractiveGoals`; a native compatibility adapter strips rich RPC tags into the stable UI model and falls back to `$/lean/plainGoal` when interactive RPC is unavailable.

## Process And Error Model

Native process results will keep two representations:

- A user-facing category, summary, and suggested recovery action.
- A debug record containing executable, argument array, selected non-secret environment, exit status, stdout, stderr, and elapsed time.

Secrets and unrelated environment values will not be logged. Cancellation will terminate the owned child process and descendants using platform-specific implementations behind one interface.

## Cross-Platform Strategy

- Use `std::path::PathBuf` and native path APIs; never split filesystem paths in Rust as strings.
- Use `std::process::Command` or an async equivalent with separate arguments; never interpolate project paths into a shell command.
- Keep executable discovery, process-tree termination, and installer behavior behind platform modules.
- Store application state in Tauri-provided app-data locations.
- Test spaces, Unicode, Windows separators, and missing executables explicitly.

## Version Compatibility

The project toolchain file selects Lean. Server capabilities are captured from the initialize response rather than assumed in React components. A compatibility adapter next to the server manager owns proof RPC decoding and fallback behavior behind one stable application interface. The live integration test has been exercised against Lean 4.14 and 4.33.

## Testing Layers

Frontend unit tests cover service boundaries, workspace transitions, editor adapters, error/loading states, and proof rendering. Rust unit tests cover project detection, executable discovery, command construction, JSON-RPC framing, and proof response parsing. An opt-in native integration test uses a temporary project and installed toolchain so the default suite remains fast and offline.