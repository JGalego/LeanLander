import { invoke, isTauri } from '@tauri-apps/api/core'
import type { WorkspaceFile } from '../model/workspace'

export interface ProjectMetadata {
  name: string
  path: string
  leanToolchain: string | null
  lakefile: string | null
  sourceRoots: string[]
  warnings: string[]
}

export interface DiscoveredProject {
  metadata: ProjectMetadata
  files: WorkspaceFile[]
  tree?: ProjectTreeNode[]
}

export interface ProjectTreeNode {
  name: string
  path: string
  kind: 'directory' | 'file'
  children: ProjectTreeNode[]
}

export interface ProjectSearchResult {
  path: string
  line: number
  preview: string
}

export interface RecentProject {
  name: string
  path: string
  openedAt: number
}

export interface ProjectClient {
  discoverProject(path: string): Promise<DiscoveredProject>
  loadFile(projectPath: string, relativePath: string): Promise<WorkspaceFile>
  loadUri?(projectPath: string, uri: string): Promise<WorkspaceFile>
  search?(projectPath: string, query: string): Promise<ProjectSearchResult[]>
  saveFile(projectPath: string, relativePath: string, content: string): Promise<void>
  recentProjects(): Promise<RecentProject[]>
}

export function errorSummary(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (
    typeof error === 'object'
    && error !== null
    && 'summary' in error
    && typeof error.summary === 'string'
  ) {
    return error.summary
  }

  return 'An unexpected native operation failed.'
}

export const projectClient: ProjectClient = {
  discoverProject(path) {
    return invoke<DiscoveredProject>('discover_project', { path })
  },

  loadFile(projectPath, relativePath) {
    return invoke<WorkspaceFile>('load_project_file', {
      projectPath,
      relativePath,
    })
  },

  loadUri(projectPath, uri) {
    return invoke<WorkspaceFile>('load_project_uri', { projectPath, uri })
  },

  search(projectPath, query) {
    return invoke<ProjectSearchResult[]>('search_project', { projectPath, query })
  },

  saveFile(projectPath, relativePath, content) {
    return invoke('save_project_file', {
      projectPath,
      relativePath,
      content,
    })
  },

  recentProjects() {
    return isTauri()
      ? invoke<RecentProject[]>('recent_projects')
      : Promise.resolve([])
  },
}