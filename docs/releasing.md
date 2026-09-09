# Releasing LeanLander

## Pipelines

The `CI` workflow runs on pull requests, pushes to `main`, and manual dispatches. It performs the frontend checks and native Rust test on Ubuntu, then produces installable workflow artifacts for:

- Linux x86_64: AppImage and Debian package
- Windows x86_64: NSIS and MSI installers
- macOS Apple Silicon: DMG
- macOS Intel: DMG

The `Release` workflow runs only when a tag beginning with `v` is pushed. It builds the same platform matrix into a draft GitHub release. A final job creates `SHA256SUMS.txt` and publishes the release only after every platform build succeeds. A failed matrix therefore leaves a draft rather than a partially published release.

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
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

The release tag must be the version prefixed with `v`. For version `0.1.0`:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The release workflow rejects a tag that does not match the application version. Do not retag a published release; increment the version and create a new tag.

## Signing

macOS artifacts currently use an ad-hoc identity so Apple Silicon can load them, but they are not notarized. Windows artifacts are not code-signed. The release notes state this explicitly. Before calling builds stable, configure Apple notarization and Windows signing secrets according to the Tauri signing guides.

Do not commit signing certificates, passwords, or private keys. Store them as GitHub Actions secrets and expose them only to the release workflow.

## First Release Documentation

The repository does not yet have a Git remote or a published release, so `README.md` intentionally retains source-development setup under **Getting Started**.

After the first release succeeds:

1. Use the exact uploaded asset names and final GitHub repository URL to write one installation command per platform.
2. Replace **Getting Started** with those released-version installation commands.
3. Move the existing clone, prerequisite, `npm ci`, and `npm run tauri dev` instructions under **Development**.
4. Test every installation command against `releases/latest` on a clean machine before publishing the documentation change.