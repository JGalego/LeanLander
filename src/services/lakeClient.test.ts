import { invoke, isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lakeClient } from './lakeClient'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedIsTauri = vi.mocked(isTauri)

describe('lakeClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedIsTauri.mockReturnValue(true)
  })

  it('passes validated project creation options as structured data', async () => {
    mockedInvoke.mockResolvedValue(undefined)
    const options = {
      parentPath: '/home/ada/Lean Projects',
      name: 'ProofGarden',
      template: 'mathlib' as const,
      initializeGit: true,
      toolchain: 'leanprover/lean4:v4.19.0',
    }

    await lakeClient.create(options)

    expect(mockedInvoke).toHaveBeenCalledWith('create_lake_project', { options })
  })

  it('starts build and dependency operations with explicit project paths', async () => {
    mockedInvoke.mockResolvedValue(undefined)

    await lakeClient.fetch('/home/ada/Proof Garden', 'leanprover/lean4:v4.19.0')
    await lakeClient.build('/home/ada/Proof Garden', 'leanprover/lean4:v4.19.0')

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, 'fetch_lake_dependencies', {
      projectPath: '/home/ada/Proof Garden',
      requiredToolchain: 'leanprover/lean4:v4.19.0',
    })
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, 'build_lake_project', {
      projectPath: '/home/ada/Proof Garden',
      requiredToolchain: 'leanprover/lean4:v4.19.0',
    })
  })

  it('does not start process work in browser preview', async () => {
    mockedIsTauri.mockReturnValue(false)

    await expect(lakeClient.create({
      parentPath: '/tmp',
      name: 'ProofGarden',
      template: 'lean',
      initializeGit: false,
      toolchain: null,
    })).rejects.toThrow('desktop application')
    await expect(lakeClient.progress()).resolves.toMatchObject({ operation: 'idle' })
    expect(mockedInvoke).not.toHaveBeenCalled()
  })
})