# Releasing LeanLander

## Pipelines

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatches. It performs the frontend and native Rust checks on Ubuntu, exercises the temporary-project, keyboard, accessibility, and performance browser workflows in Chromium, then produces installable workflow artifacts for:

- Linux x86_64: AppImage and Debian package
- Windows x86_64: NSIS and MSI installers
- macOS Apple Silicon: DMG
- macOS Intel: DMG

The `Release` workflow runs only when a tag beginning with `v` is pushed. It verifies that the tag matches the application version, reruns the release gates, and builds the same platform matrix into a draft GitHub release. A final job creates `SHA256SUMS.txt` and publishes the release only after every platform build succeeds. A failed matrix therefore leaves a draft rather than a partially published release.

GitHub Releases is the only binary distribution channel. Do not add app-store, Homebrew, package-repository, or other official-channel publication jobs. Users install from the release page or with the direct download commands in `README.md`; developers can build from source.

Release bundles use the icons and installer metadata in `src-tauri/tauri.conf.json`. The MSI upgrade code is pinned so product-name changes cannot create duplicate Windows installations.

## Versioning

A release version must agree in all of these files:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`

Run this after changing them:

```bash
npm install --package-lock-only
npm run version:check
npm run check
npm run e2e
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

The release tag must be the version prefixed with `v`. For version `0.2.0`:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The release workflow rejects a tag that does not match the application version. Do not retag a published release; increment the version and create a new tag.

## Community Builds

Release artifacts are checksummed but are not code-signed or notarized. The release workflow does not require Apple or Windows signing credentials. Installation documentation must state that macOS and Windows can display an unidentified-developer warning and must not imply endorsement by an app store or operating-system package repository.

## Newcomer Acceptance

The v0.2.0 newcomer workflow completed in 6.332 seconds on September 10, 2026. It installed the fixture's missing project toolchain, created `ArithmeticProof`, entered `example : 2 + 2 = 4 := by decide`, observed no remaining goals, and saved the source. The run stayed below its 120-second budget; watch the [Playwright recording](assets/demos/newcomer-acceptance-v0.2.0.webm).

This deterministic browser acceptance uses mocked native boundaries and requires no Lean installation on the host. It verifies the complete UI workflow and its toolchain state transition, not Elan download speed on a physical clean machine.

## Performance Profile

`npm run profile` starts the deterministic browser harness with 5,000 lazy Mathlib-style source descriptors and measures Chromium with garbage collection before each heap sample. It records bootstrap-to-React-commit time, bootstrap-to-Monaco-ready time, initial JavaScript heap, and heap growth after opening a generated Lean source near 1 MiB. Results are attached as JSON by Playwright.

The local Chromium baseline on March 24, 2026 was:

| Measurement | Baseline | Regression ceiling |
| --- | ---: | ---: |
| React commit | 303 ms | 2,000 ms |
| Monaco ready | 2,293 ms | 8,000 ms |
| Initial JS heap | 35.5 MiB | 180 MiB |
| Heap growth for 954 KB Lean source | 51.8 MiB | 96 MiB |

The ceilings catch large regressions across heterogeneous CI hosts; the baseline is descriptive, not a universal hardware claim. Refresh it intentionally after dependency or architecture changes and retain the prior result in version history.

## Release Documentation

Before publishing, verify the exact uploaded asset names and test every installation command against `releases/latest` on a clean machine. Keep source-development setup under **Development** and release downloads under **Installation**.