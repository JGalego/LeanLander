import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { ProofState } from '../model/workspace'

export type ServerState = 'offline' | 'starting' | 'ready' | 'error' | 'unavailable'
export type LanguageFeature =
  | 'hover'
  | 'completion'
  | 'definition'
  | 'references'
  | 'documentSymbols'

export interface ServerStatus {
  state: ServerState
  message: string
  toolchain: string | null
  version: string | null
  capabilities: string[]
}

export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface DocumentChange {
  range: LspRange
  text: string
}

export interface LspDiagnostic {
  range: LspRange
  severity?: number
  code?: string | number
  source?: string
  message: string
}

export interface DiagnosticEvent {
  uri: string
  diagnostics: LspDiagnostic[]
}

export interface FileProgressEvent {
  textDocument?: { uri?: string }
  processing?: unknown[]
}

export interface LeanMessage {
  message: string
  severity: number
}

export interface LspLocation {
  uri: string
  range: LspRange
}

export interface LspLocationLink {
  targetUri: string
  targetRange: LspRange
  targetSelectionRange: LspRange
  originSelectionRange?: LspRange
}

export interface LspMarkupContent {
  kind: 'plaintext' | 'markdown'
  value: string
}

export interface LspHover {
  contents: LspMarkupContent | string | Array<LspMarkupContent | string>
  range?: LspRange
}

export interface LspCompletionItem {
  label: string | { label: string; detail?: string; description?: string }
  kind?: number
  detail?: string
  documentation?: LspMarkupContent | string
  insertText?: string
  sortText?: string
  filterText?: string
}

export interface LspCompletionList {
  isIncomplete: boolean
  items: LspCompletionItem[]
}

export interface LspDocumentSymbol {
  name: string
  detail?: string
  kind: number
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}

export interface LanguageClient {
  start(projectPath: string, requiredToolchain: string | null): Promise<ServerStatus>
  status(projectPath: string): Promise<ServerStatus>
  stop(projectPath: string): Promise<void>
  syncDocument(
    projectPath: string,
    relativePath: string,
    content: string,
    version: number,
    changes?: DocumentChange[],
  ): Promise<number>
  closeDocument(projectPath: string, relativePath: string): Promise<void>
  diagnostics(projectPath: string, relativePath: string): Promise<LspDiagnostic[]>
  request<T>(
    projectPath: string,
    relativePath: string,
    feature: LanguageFeature,
    position: LspPosition,
  ): Promise<T | null>
  proofState(
    projectPath: string,
    relativePath: string,
    position: LspPosition,
  ): Promise<ProofState>
  onDiagnostics?(handler: (event: DiagnosticEvent) => void): Promise<UnlistenFn>
  onFileProgress?(handler: (event: FileProgressEvent) => void): Promise<UnlistenFn>
  onMessage?(handler: (event: LeanMessage) => void): Promise<UnlistenFn>
}

export const offlineServerStatus: ServerStatus = {
  state: 'offline',
  message: 'Lean server offline',
  toolchain: null,
  version: null,
  capabilities: [],
}

const browserServerStatus: ServerStatus = {
  ...offlineServerStatus,
  state: 'unavailable',
  message: 'Native Lean server unavailable in browser preview',
}

const noProofState: ProofState = {
  declaration: 'No active declaration',
  goalCount: 0,
  hypotheses: [],
}

export const languageClient: LanguageClient = {
  start(projectPath, requiredToolchain) {
    return isTauri()
      ? invoke<ServerStatus>('start_lean_server', { projectPath, requiredToolchain })
      : Promise.resolve(browserServerStatus)
  },

  status(projectPath) {
    return isTauri()
      ? invoke<ServerStatus>('lean_server_status', { projectPath })
      : Promise.resolve(browserServerStatus)
  },

  stop(projectPath) {
    return isTauri()
      ? invoke('stop_lean_server', { projectPath })
      : Promise.resolve()
  },

  syncDocument(projectPath, relativePath, content, version, changes) {
    return isTauri()
      ? invoke<number>('sync_lean_document', {
          projectPath,
          relativePath,
          content,
          version,
          changes,
        })
      : Promise.resolve(version)
  },

  closeDocument(projectPath, relativePath) {
    return isTauri()
      ? invoke('close_lean_document', { projectPath, relativePath })
      : Promise.resolve()
  },

  diagnostics(projectPath, relativePath) {
    return isTauri()
      ? invoke<LspDiagnostic[]>('lean_diagnostics', { projectPath, relativePath })
      : Promise.resolve([])
  },

  request<T>(
    projectPath: string,
    relativePath: string,
    feature: LanguageFeature,
    position: LspPosition,
  ): Promise<T | null> {
    return isTauri()
      ? invoke<T | null>('lean_language_request', {
          projectPath,
          relativePath,
          feature,
          line: position.line,
          character: position.character,
        })
      : Promise.resolve(null)
  },

  proofState(projectPath, relativePath, position) {
    return isTauri()
      ? invoke<ProofState>('lean_proof_state', {
          projectPath,
          relativePath,
          line: position.line,
          character: position.character,
        })
      : Promise.resolve(noProofState)
  },

  onDiagnostics(handler) {
    return isTauri()
      ? listen<DiagnosticEvent>('lean-diagnostics', ({ payload }) => handler(payload))
      : Promise.resolve(() => undefined)
  },

  onFileProgress(handler) {
    return isTauri()
      ? listen<FileProgressEvent>('lean-file-progress', ({ payload }) => handler(payload))
      : Promise.resolve(() => undefined)
  },

  onMessage(handler) {
    return isTauri()
      ? listen<LeanMessage>('lean-message', ({ payload }) => handler(payload))
      : Promise.resolve(() => undefined)
  },
}