import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [packageJsonSource, tauriConfigSource] = await Promise.all([
  readFile(new URL('../package.json', import.meta.url), 'utf8'),
  readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
])

const packageVersion = JSON.parse(packageJsonSource).version
const tauriVersion = JSON.parse(tauriConfigSource).version
const cargoManifestPath = fileURLToPath(
  new URL('../src-tauri/Cargo.toml', import.meta.url),
)
const cargoMetadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--manifest-path',
      cargoManifestPath,
      '--locked',
      '--no-deps',
      '--format-version',
      '1',
    ],
    { encoding: 'utf8' },
  ),
)
const cargoPackage = cargoMetadata.packages.find(
  ({ manifest_path }) => resolve(manifest_path) === resolve(cargoManifestPath),
)
const cargoVersion = cargoPackage?.version

const versions = new Map([
  ['package.json', packageVersion],
  ['src-tauri/tauri.conf.json', tauriVersion],
  ['src-tauri/Cargo.toml', cargoVersion],
])
const uniqueVersions = new Set(versions.values())

if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  for (const [file, version] of versions) {
    console.error(`${file}: ${version ?? 'missing version'}`)
  }
  process.exit(1)
}

const version = packageVersion
const releaseTag = process.argv[2]

if (releaseTag && releaseTag !== `v${version}`) {
  console.error(`Release tag ${releaseTag} does not match application version v${version}.`)
  process.exit(1)
}

console.log(`LeanLander version ${version} is consistent.`)