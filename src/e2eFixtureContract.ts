export interface E2eWorkspaceFile {
  id: string
  name: string
  path: string
  content: string
  loaded?: boolean
  readOnly?: boolean
}

export interface E2eProofState {
  goals?: Array<{
    declaration: string
    hypotheses: Array<{ name: string; type: string }>
    target: string
  }>
  declaration?: string
  goalCount?: number
  hypotheses?: Array<{ name: string; type: string }>
  target?: string
}

export interface E2eDiagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  severity?: number
  code?: string | number
  source?: string
  message: string
}

export interface E2eFixture {
  project: {
    metadata: {
      name: string
      path: string
      leanToolchain: string | null
      lakefile: string | null
      sourceRoots: string[]
      warnings: string[]
    }
    files: E2eWorkspaceFile[]
    tree?: Array<unknown>
  }
  dependencyFiles?: Record<string, E2eWorkspaceFile>
  recentProjects?: Array<{ name: string; path: string; openedAt: number }>
  toolchainStatus?: {
    state: 'checking' | 'ready' | 'missing-elan' | 'missing-toolchain' | 'unavailable' | 'error'
    elanPath: string | null
    elanVersion: string | null
    requiredToolchain: string | null
    activeToolchain: string | null
    installedToolchains: Array<{ name: string; installed: boolean; active: boolean }>
    repairs: Array<{
      id: string
      label: string
      description: string
      command: string[]
      canRun: boolean
    }>
  }
  serverStatus?: {
    state: 'offline' | 'starting' | 'ready' | 'error' | 'unavailable'
    message: string
    toolchain: string | null
    version: string | null
    capabilities: string[]
  }
  diagnostics?: Record<string, E2eDiagnostic[]>
  proofStates?: Record<string, E2eProofState>
  infoview?: {
    widgets: Array<{ id: string; javascriptHash: string; props: unknown }>
    widgetSource: string
    rpcResponses?: Record<string, unknown | unknown[]>
  }
  doctorReport?: {
    status: 'ok' | 'warning' | 'error' | 'unavailable'
    checks: Array<{
      id: string
      label: string
      status: 'ok' | 'warning' | 'error' | 'unavailable'
      summary: string
      repair: {
        id: string
        label: string
        description: string
        canRun: boolean
      } | null
    }>
  }
  doctorLogs?: {
    sections: Array<{ label: string; content: string }>
  }
  lakeProgress?: {
    operation: 'idle' | 'create' | 'fetch' | 'build'
    stage: string
    message: string
    running: boolean
    succeeded: boolean | null
    projectPath: string | null
    failure: {
      category: string
      summary: string
      suggestion: string
      details: string | null
    } | null
  }
  lakeBuildProgress?: {
    operation: 'build'
    stage: string
    message: string
    running: boolean
    succeeded: boolean | null
    projectPath: string | null
    failure: {
      category: string
      summary: string
      suggestion: string
      details: string | null
    } | null
  }
}
