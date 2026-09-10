import { invoke, isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toolchainClient } from './toolchainClient'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedIsTauri = vi.mocked(isTauri)

describe('toolchainClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedIsTauri.mockReturnValue(true)
  })

  it('checks the exact project-required toolchain', async () => {
    mockedInvoke.mockResolvedValue({ state: 'ready' })

    await toolchainClient.status('leanprover/lean4:v4.19.0')

    expect(mockedInvoke).toHaveBeenCalledWith('toolchain_status', {
      requiredToolchain: 'leanprover/lean4:v4.19.0',
    })
  })

  it('passes toolchains as structured install arguments', async () => {
    mockedInvoke.mockResolvedValue(undefined)

    await toolchainClient.install('leanprover/lean4:v4.19.0')

    expect(mockedInvoke).toHaveBeenCalledWith('install_toolchain', {
      toolchain: 'leanprover/lean4:v4.19.0',
    })
  })

  it('reports native services as unavailable in a browser', async () => {
    mockedIsTauri.mockReturnValue(false)

    await expect(toolchainClient.status(null)).resolves.toMatchObject({
      state: 'unavailable',
    })
    expect(mockedInvoke).not.toHaveBeenCalled()
  })

  it('can cancel an in-flight installation', async () => {
    mockedInvoke.mockResolvedValue(undefined)

    await toolchainClient.cancel()

    expect(mockedInvoke).toHaveBeenCalledWith('cancel_toolchain_install')
  })
})