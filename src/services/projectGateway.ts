import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

export interface ProjectSelection {
  name: string
  path: string
}

export interface ProjectGateway {
  chooseProject(): Promise<ProjectSelection | null>
  chooseProjectParent(): Promise<ProjectSelection | null>
}

export function projectNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? path
}

export const projectGateway: ProjectGateway = {
  chooseProject() {
    return chooseDirectory('Open a Lean project')
  },

  chooseProjectParent() {
    return chooseDirectory('Choose where to create the project')
  },
}

async function chooseDirectory(title: string): Promise<ProjectSelection | null> {
  if (!isTauri()) {
    return null
  }

  const selectedPath = await open({
    directory: true,
    multiple: false,
    title,
  })

  if (typeof selectedPath !== 'string') {
    return null
  }

  return {
    name: projectNameFromPath(selectedPath),
    path: selectedPath,
  }
}