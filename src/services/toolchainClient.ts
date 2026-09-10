import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type ToolchainState =
  | 'checking'
  | 'ready'
  | 'missing-elan'
  | 'missing-toolchain'
  | 'unavailable'
  | 'error'

export interface ToolchainInfo {
  name: string
  installed: boolean
  active: boolean
}

export interface RepairAction {
  id: string
  label: string
  description: string
  command: string[]
  canRun: boolean
}

export interface ToolchainStatus {
  state: ToolchainState
  elanPath: string | null
  elanVersion: string | null
  requiredToolchain: string | null
  activeToolchain: string | null
  installedToolchains: ToolchainInfo[]
  repairs: RepairAction[]
}

export interface InstallProgress {
  stage: string
  message: string
  running: boolean
  succeeded: boolean | null
}

export interface ToolchainClient {
  status(requiredToolchain: string | null): Promise<ToolchainStatus>
  install(toolchain: string): Promise<void>
  progress(): Promise<InstallProgress>
  cancel(): Promise<void>
  onProgress?(handler: (progress: InstallProgress) => void): Promise<UnlistenFn>
}

export const checkingToolchainStatus: ToolchainStatus = {
  state: 'checking',
  elanPath: null,
  elanVersion: null,
  requiredToolchain: null,
  activeToolchain: null,
  installedToolchains: [],
  repairs: [],
}

const browserToolchainStatus: ToolchainStatus = {
  ...checkingToolchainStatus,
  state: 'unavailable',
}

export const toolchainClient: ToolchainClient = {
  status(requiredToolchain) {
    return isTauri()
      ? invoke<ToolchainStatus>('toolchain_status', { requiredToolchain })
      : Promise.resolve(browserToolchainStatus)
  },

  install(toolchain) {
    return invoke('install_toolchain', { toolchain })
  },

  progress() {
    return invoke<InstallProgress>('toolchain_install_progress')
  },

  cancel() {
    return invoke('cancel_toolchain_install')
  },

  onProgress(handler) {
    return isTauri()
      ? listen<InstallProgress>('toolchain-progress', ({ payload }) => handler(payload))
      : Promise.resolve(() => undefined)
  },
}