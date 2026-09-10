import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import type { E2eFixture } from './e2eFixtureContract'

export const e2eFixtureKey = 'leanlander:e2e-fixture'

const readyToolchain = {
  state: 'ready',
  elanPath: '/mock/.elan/bin/elan',
  elanVersion: '4.2.0',
  requiredToolchain: null,
  activeToolchain: 'leanprover/lean4:v4.19.0',
  installedToolchains: [],
  repairs: [],
} satisfies NonNullable<E2eFixture['toolchainStatus']>

const readyServer = {
  state: 'ready',
  message: 'Lean server ready',
  toolchain: 'leanprover/lean4:v4.19.0',
  version: '4.19.0',
  capabilities: ['diagnostics', 'proofState'],
}

const emptyProofState = {
  declaration: 'No active declaration',
  goalCount: 0,
  hypotheses: [],
}

const idleLakeProgress = {
  operation: 'idle',
  stage: 'idle',
  message: 'No Lake operation is running.',
  running: false,
  succeeded: null,
  projectPath: null,
  failure: null,
}

export function installE2eHarness() {
  const serialized = localStorage.getItem(e2eFixtureKey)
  if (!serialized) {
    throw new Error(`Missing ${e2eFixtureKey}`)
  }
  const fixture = JSON.parse(serialized) as E2eFixture
  const files = new Map(fixture.project.files.map((file) => [file.path, { ...file }]))
  const dependencyFiles = new Map(Object.entries(fixture.dependencyFiles ?? {}))
  let syncCount = 0
  let lakeProgress = fixture.lakeProgress ?? idleLakeProgress
  let toolchainStatus = fixture.toolchainStatus
  const rpcResponseCounts = new Map<string, number>()

  Object.defineProperty(globalThis, 'isTauri', {
    configurable: true,
    value: true,
  })
  mockWindows('main')
  mockIPC((command, payload = {}) => {
    const args = payload as Record<string, unknown>
    switch (command) {
      case 'plugin:dialog|open':
        return fixture.project.metadata.path
      case 'discover_project':
        return fixture.project
      case 'load_project_file':
        return files.get(String(args.relativePath)) ?? null
      case 'load_project_uri': {
        const uri = decodeURIComponent(String(args.uri))
        const dependency = [...dependencyFiles.entries()]
          .find(([path]) => uri.endsWith(path))?.[1]
        if (dependency) return dependency
        return [...files.values()].find((file) => uri.endsWith(`/${file.path}`)) ?? null
      }
      case 'search_project': {
        const query = String(args.query)
        return [...files.values()].flatMap((file) => file.content
          .split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => line.includes(query))
          .map(({ line, index }) => ({
            path: file.path,
            line: index + 1,
            preview: line.trim(),
          })))
      }
      case 'save_project_file': {
        const path = String(args.relativePath)
        const file = files.get(path)
        if (file) {
          files.set(path, { ...file, content: String(args.content) })
        }
        return null
      }
      case 'recent_projects':
        return fixture.recentProjects ?? []
      case 'toolchain_status':
        return {
          ...readyToolchain,
          requiredToolchain: fixture.project.metadata.leanToolchain,
          ...toolchainStatus,
        }
      case 'install_toolchain':
        toolchainStatus = {
          ...readyToolchain,
          requiredToolchain: fixture.project.metadata.leanToolchain,
          activeToolchain: fixture.project.metadata.leanToolchain,
        }
        return null
      case 'cancel_toolchain_install':
        return null
      case 'toolchain_install_progress':
        return {
          stage: 'complete',
          message: 'Toolchain installed.',
          running: false,
          succeeded: true,
        }
      case 'start_lean_server':
      case 'lean_server_status':
        return {
          ...readyServer,
          toolchain: fixture.project.metadata.leanToolchain,
          ...fixture.serverStatus,
        }
      case 'stop_lean_server':
      case 'close_lean_document':
        return null
      case 'sync_lean_document':
        syncCount += 1
        document.documentElement.dataset.syncCount = String(syncCount)
        return Number(args.version)
      case 'lean_diagnostics':
        return fixture.diagnostics?.[String(args.relativePath)] ?? []
      case 'lean_language_request':
        return null
      case 'lean_proof_state':
        return fixture.proofStates?.[String(args.relativePath)] ?? emptyProofState
      case 'create_lean_rpc_session':
        return 'e2e-session'
      case 'close_lean_rpc_session':
      case 'lean_infoview_notification':
        return null
      case 'lean_infoview_request': {
        const params = args.params as Record<string, unknown>
        switch (params.method) {
          case 'Lean.Widget.getInteractiveGoals':
            return { goals: [] }
          case 'Lean.Widget.getInteractiveTermGoal':
            return null
          case 'Lean.Widget.getInteractiveDiagnostics':
            return []
          case 'Lean.Widget.getWidgets':
            return { widgets: fixture.infoview?.widgets ?? [] }
          case 'Lean.Widget.getWidgetSource':
            return fixture.infoview ? { sourcetext: fixture.infoview.widgetSource } : null
          default: {
            const method = String(params.method)
            const response = fixture.infoview?.rpcResponses?.[method]
            if (!Array.isArray(response)) return response ?? null
            const index = rpcResponseCounts.get(method) ?? 0
            rpcResponseCounts.set(method, index + 1)
            return response[Math.min(index, response.length - 1)] ?? null
          }
        }
      }
      case 'create_lake_project':
      case 'fetch_lake_dependencies':
      case 'build_lake_project':
        lakeProgress = command === 'build_lake_project' && fixture.lakeBuildProgress
          ? fixture.lakeBuildProgress
          : {
            operation: command === 'create_lake_project'
              ? 'create'
              : command === 'fetch_lake_dependencies'
                ? 'fetch'
                : 'build',
            stage: 'complete',
            message: command === 'build_lake_project'
              ? 'Build completed'
              : 'Dependencies are up to date',
            running: false,
            succeeded: true,
            projectPath: fixture.project.metadata.path,
            failure: null,
          }
        return null
      case 'lake_operation_progress':
        return lakeProgress
      case 'cancel_lake_operation':
        return null
      case 'diagnose_environment':
        return fixture.doctorReport ?? {
          status: 'ok',
          checks: [
            {
              id: 'toolchain',
              label: 'Toolchain',
              status: 'ok',
              summary: `Using ${fixture.project.metadata.leanToolchain ?? 'the active toolchain'}.`,
              repair: null,
            },
            {
              id: 'server',
              label: 'Lean server',
              status: 'ok',
              summary: 'Lean server ready',
              repair: null,
            },
          ],
        }
      case 'doctor_logs':
        return fixture.doctorLogs ?? {
          sections: [{ label: 'Environment', content: 'E2E fixture environment' }],
        }
      default:
        throw new Error(`Unhandled E2E command: ${command}`)
    }
  })
  document.documentElement.dataset.e2eHarness = 'ready'
}