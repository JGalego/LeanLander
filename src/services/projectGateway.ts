import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export interface ProjectSelection {
  name: string
  path: string
}

export interface ProjectGateway {
  chooseProject(): Promise<ProjectSelection | null>
}

export function projectNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? path
}

export const projectGateway: ProjectGateway = {
  async chooseProject() {
    if (!isTauri()) {
      return null
    }

    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: 'Open a Lean project',
    })

    if (typeof selectedPath !== 'string') {
      return null
    }

    return {
      name: projectNameFromPath(selectedPath),
      path: selectedPath,
    }
  },
}