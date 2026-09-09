import { invoke, isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errorSummary, projectClient } from './projectClient'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedIsTauri = vi.mocked(isTauri)

describe('projectClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedIsTauri.mockReturnValue(true)
  })

  it('uses structured arguments to discover a project', async () => {
    mockedInvoke.mockResolvedValue({ metadata: { name: 'Proof Garden' }, files: [] })

    await projectClient.discoverProject('/home/ada/Proof Garden')

    expect(mockedInvoke).toHaveBeenCalledWith('discover_project', {
      path: '/home/ada/Proof Garden',
    })
  })

  it('saves source content without constructing a shell command', async () => {
    mockedInvoke.mockResolvedValue(undefined)

    await projectClient.saveFile('/tmp/形式化', 'Garden/Main.lean', 'theorem seed : True := by trivial')

    expect(mockedInvoke).toHaveBeenCalledWith('save_project_file', {
      projectPath: '/tmp/形式化',
      relativePath: 'Garden/Main.lean',
      content: 'theorem seed : True := by trivial',
    })
  })

  it('does not request recent native projects in a browser', async () => {
    mockedIsTauri.mockReturnValue(false)

    await expect(projectClient.recentProjects()).resolves.toEqual([])
    expect(mockedInvoke).not.toHaveBeenCalled()
  })
})

describe('errorSummary', () => {
  it('reads structured native errors', () => {
    expect(errorSummary({ summary: 'The project could not be opened.' }))
      .toBe('The project could not be opened.')
  })
})