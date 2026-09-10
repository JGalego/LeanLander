# Releasing LeanLander

## Pipelines

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatches. It performs the frontend and native Rust checks on Ubuntu, exercises the temporary-project, keyboard, accessibility, and performance browser workflows in Chromium, then produces installable workflow artifacts for:

- Linux x86_64: AppImage and Debian package
- Windows x86_64: NSIS and MSI installers
- macOS Apple Silicon: DMG
- macOS Intel: DMG

The `Release` workflow runs only when a tag beginning with `v` is pushed. It verifies that the tag matches the application version, reruns the release gates, and builds the same platform matrix into a draft GitHub release. A final job creates `SHA256SUMS.txt` and publishes the release only after every platform build succeeds. A failed matrix therefore leaves a draft rather than a partially published release.

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

The release tag must be the version prefixed with `v`. For version `0.1.0`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow rejects a tag that does not match the application version. Do not retag a published release; increment the version and create a new tag.

## Signing Credentials

Unsigned builds remain supported. macOS bundles use an ad-hoc signature when Apple credentials are absent, and Windows bundles remain unsigned. The release notes identify that possibility rather than claiming verification that did not happen.

Configure these GitHub Actions secrets for Developer ID signing and Apple notarization:

- `APPLE_CERTIFICATE`: base64-encoded Developer ID Application `.p12`
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `APPLE_SIGNING_IDENTITY`: full Developer ID Application identity
- `APPLE_ID`: notarization Apple ID
- `APPLE_PASSWORD`: app-specific password for that Apple ID
- `APPLE_TEAM_ID`: Apple Developer team identifier

Configure these secrets for Windows Authenticode signing:

- `WINDOWS_CERTIFICATE`: raw `.pfx` bytes encoded as one base64 string
- `WINDOWS_CERTIFICATE_PASSWORD`: `.pfx` export password
- `WINDOWS_TIMESTAMP_URL`: timestamp URL supplied by the certificate issuer

Create the Windows certificate value from PowerShell without PEM headers:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('certificate.pfx'))
```

The workflow writes certificates only to the hosted runner's temporary storage, imports the Windows certificate into the current-user store, derives its thumbprint, and deletes the temporary `.pfx` before building. Certificates and passwords must never be committed.

## Performance Profile

`npm run profile` starts the deterministic browser harness and measures Chromium with garbage collection before each heap sample. It records bootstrap-to-React-commit time, bootstrap-to-Monaco-ready time, initial JavaScript heap, and heap growth after opening a generated Lean source near 1 MiB. Results are attached as JSON by Playwright.

The first local Chromium baseline on March 23, 2026 was:

| Measurement | Baseline | Regression ceiling |
| --- | ---: | ---: |
| React commit | 303 ms | 2,000 ms |
| Monaco ready | 2,155 ms | 8,000 ms |
| Initial JS heap | 35.6 MB | 180 MiB |
| Heap growth for 954 KB Lean source | 3.5 MB | 96 MiB |

The ceilings catch large regressions across heterogeneous CI hosts; the baseline is descriptive, not a universal hardware claim. Refresh it intentionally after dependency or architecture changes and retain the prior result in version history.

## First Release Documentation

Until the first release succeeds, `README.md` retains source-development setup under **Getting Started**. After release:

1. Use the exact uploaded asset names to write one installation command per platform.
2. Replace **Getting Started** with those released-version installation commands.
3. Move the existing clone, prerequisite, `npm ci`, and `npm run tauri dev` instructions under **Development**.
4. Test every installation command against `releases/latest` on a clean machine before publishing the documentation change.