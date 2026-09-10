import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectGateway, projectNameFromPath } from './projectGateway'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))

const mockedIsTauri = vi.mocked(isTauri)
const mockedOpen = vi.mocked(open)

describe('projectGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not request native access in a browser', async () => {
    mockedIsTauri.mockReturnValue(false)

    await expect(projectGateway.chooseProject()).resolves.toBeNull()
    await expect(projectGateway.chooseProjectParent()).resolves.toBeNull()
    expect(mockedOpen).not.toHaveBeenCalled()
  })

  it('chooses a parent directory for a new project', async () => {
    mockedIsTauri.mockReturnValue(true)
    mockedOpen.mockResolvedValue('/home/ada/Lean Projects')

    await expect(projectGateway.chooseProjectParent()).resolves.toEqual({
      name: 'Lean Projects',
      path: '/home/ada/Lean Projects',
    })
    expect(mockedOpen).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: 'Choose where to create the project',
    })
  })

  it('returns the selected project without shell parsing', async () => {
    mockedIsTauri.mockReturnValue(true)
    mockedOpen.mockResolvedValue('C:\\Lean Projects\\Álgebra')

    await expect(projectGateway.chooseProject()).resolves.toEqual({
      name: 'Álgebra',
      path: 'C:\\Lean Projects\\Álgebra',
    })
    expect(mockedOpen).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: 'Open a Lean project',
    })
  })
})

describe('projectNameFromPath', () => {
  it.each([
    ['/home/ada/Proof Garden', 'Proof Garden'],
    ['C:\\Users\\Ada\\Proof Garden\\', 'Proof Garden'],
    ['/tmp/形式化', '形式化'],
  ])('extracts a name from %s', (path, expectedName) => {
    expect(projectNameFromPath(path)).toBe(expectedName)
  })
})