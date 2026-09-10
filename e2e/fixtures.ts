import type { Page } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import type { E2eFixture, E2eProofState } from '../src/e2eFixtureContract.js'

interface LeanSource {
  path: string
  content: string
  proofState?: E2eProofState
}

interface TemporaryProject {
  fixture: E2eFixture
  root: string
  dispose: () => Promise<void>
}

export async function createTemporaryLeanProject(
  name: string,
  sources: LeanSource[],
): Promise<TemporaryProject> {
  const parent = await mkdtemp(join(tmpdir(), 'leanlander-e2e-'))
  const root = join(parent, name)
  await mkdir(root)
  await writeFile(join(root, 'lean-toolchain'), 'leanprover/lean4:v4.19.0\n')
  await writeFile(join(root, 'lakefile.toml'), `name = "${name}"\nversion = "0.1.0"\n`)
  await writeFile(join(root, 'lake-manifest.json'), '{"version":"1.1.0","packages":[]}\n')

  for (const source of sources) {
    const absolutePath = join(root, source.path)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, source.content)
  }

  const normalized = (path: string) => path.split(sep).join('/')
  const proofStates: Record<string, E2eProofState> = {}
  for (const source of sources) {
    if (source.proofState) {
      proofStates[normalized(source.path)] = source.proofState
    }
  }
  return {
    root,
    fixture: {
      project: {
        metadata: {
          name,
          path: root,
          leanToolchain: 'leanprover/lean4:v4.19.0',
          lakefile: 'lakefile.toml',
          sourceRoots: [...new Set(sources.map((source) => {
            const parentPath = dirname(source.path)
            return parentPath === '.' ? '.' : normalized(parentPath).split('/')[0]
          }))],
          warnings: [],
        },
        files: sources.map((source) => {
          const path = normalized(relative(root, join(root, source.path)))
          return {
            id: path,
            name: basename(path),
            path,
            content: source.content,
          }
        }),
      },
      proofStates,
    },
    dispose: () => rm(parent, { recursive: true, force: true }),
  }
}

export async function installFixture(page: Page, fixture: E2eFixture) {
  await page.addInitScript((value) => {
    localStorage.setItem('leanlander:e2e-fixture', JSON.stringify(value))
  }, fixture)
}