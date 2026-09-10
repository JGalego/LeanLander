import { invoke, isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { doctorClient } from './doctorClient'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedIsTauri = vi.mocked(isTauri)

describe('doctorClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedIsTauri.mockReturnValue(true)
  })

  it('requests a report for the selected project and toolchain', async () => {
    mockedInvoke.mockResolvedValue({ status: 'ok', checks: [] })

    await doctorClient.diagnose(
      '/home/ada/Proof Garden',
      'leanprover/lean4:v4.19.0',
    )

    expect(mockedInvoke).toHaveBeenCalledWith('diagnose_environment', {
      projectPath: '/home/ada/Proof Garden',
      requiredToolchain: 'leanprover/lean4:v4.19.0',
    })
  })

  it('loads detailed logs only through the dedicated command', async () => {
    mockedInvoke.mockResolvedValue({ sections: [] })

    await doctorClient.logs('/home/ada/Proof Garden', null)

    expect(mockedInvoke).toHaveBeenCalledWith('doctor_logs', {
      projectPath: '/home/ada/Proof Garden',
      requiredToolchain: null,
    })
  })

  it('reports desktop diagnostics as unavailable in browser preview', async () => {
    mockedIsTauri.mockReturnValue(false)

    await expect(doctorClient.diagnose(null, null)).resolves.toMatchObject({
      status: 'unavailable',
    })
    await expect(doctorClient.logs(null, null)).resolves.toMatchObject({
      sections: [{ label: 'Environment' }],
    })
    expect(mockedInvoke).not.toHaveBeenCalled()
  })
})