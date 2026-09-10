import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type ProjectTemplate = 'lean' | 'mathlib'

export interface CreateProjectOptions {
  parentPath: string
  name: string
  template: ProjectTemplate
  initializeGit: boolean
  toolchain: string | null
}

export interface OperationFailure {
  category: string
  summary: string
  suggestion: string
  details: string | null
}

export interface LakeProgress {
  operation: 'idle' | 'create' | 'fetch' | 'build'
  stage: string
  message: string
  running: boolean
  succeeded: boolean | null
  projectPath: string | null
  failure: OperationFailure | null
}

export interface LakeClient {
  create(options: CreateProjectOptions): Promise<void>
  fetch(projectPath: string, requiredToolchain: string | null): Promise<void>
  build(projectPath: string, requiredToolchain: string | null): Promise<void>
  progress(): Promise<LakeProgress>
  cancel(): Promise<void>
  onProgress?(handler: (progress: LakeProgress) => void): Promise<UnlistenFn>
}

export const idleLakeProgress: LakeProgress = {
  operation: 'idle',
  stage: 'idle',
  message: 'No Lake operation is running.',
  running: false,
  succeeded: null,
  projectPath: null,
  failure: null,
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error('Lake operations require the desktop application.'))
}

export const lakeClient: LakeClient = {
  create(options) {
    return isTauri()
      ? invoke('create_lake_project', { options })
      : unavailable()
  },

  fetch(projectPath, requiredToolchain) {
    return isTauri()
      ? invoke('fetch_lake_dependencies', { projectPath, requiredToolchain })
      : unavailable()
  },

  build(projectPath, requiredToolchain) {
    return isTauri()
      ? invoke('build_lake_project', { projectPath, requiredToolchain })
      : unavailable()
  },

  progress() {
    return isTauri()
      ? invoke<LakeProgress>('lake_operation_progress')
      : Promise.resolve(idleLakeProgress)
  },

  cancel() {
    return isTauri()
      ? invoke('cancel_lake_operation')
      : Promise.resolve()
  },

  onProgress(handler) {
    return isTauri()
      ? listen<LakeProgress>('lake-progress', ({ payload }) => handler(payload))
      : Promise.resolve(() => undefined)
  },
}