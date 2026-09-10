import { invoke, isTauri } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { languageClient } from './languageClient'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

const mockedInvoke = vi.mocked(invoke)
const mockedIsTauri = vi.mocked(isTauri)

describe('languageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedIsTauri.mockReturnValue(true)
  })

  it('starts one workspace server with the selected toolchain', async () => {
    mockedInvoke.mockResolvedValue({ state: 'ready' })

    await languageClient.start('/home/ada/Proof Garden', 'leanprover/lean4:v4.19.0')

    expect(mockedInvoke).toHaveBeenCalledWith('start_lean_server', {
      projectPath: '/home/ada/Proof Garden',
      requiredToolchain: 'leanprover/lean4:v4.19.0',
    })
  })

  it('sends full document versions as structured command arguments', async () => {
    mockedInvoke.mockResolvedValue(4)

    await languageClient.syncDocument(
      '/home/ada/Proof Garden',
      'Garden/Main.lean',
      'theorem seed : True := by trivial',
      4,
    )

    expect(mockedInvoke).toHaveBeenCalledWith('sync_lean_document', {
      projectPath: '/home/ada/Proof Garden',
      relativePath: 'Garden/Main.lean',
      content: 'theorem seed : True := by trivial',
      version: 4,
    })
  })

  it('forwards zero-based positions when invoking proof RPC', async () => {
    mockedInvoke.mockResolvedValue({
      declaration: 'Active proof',
      goalCount: 1,
      hypotheses: [],
      target: 'True',
    })

    await languageClient.proofState(
      '/home/ada/Proof Garden',
      'Garden/Main.lean',
      { line: 6, character: 2 },
    )

    expect(mockedInvoke).toHaveBeenCalledWith('lean_proof_state', {
      projectPath: '/home/ada/Proof Garden',
      relativePath: 'Garden/Main.lean',
      line: 6,
      character: 2,
    })
  })

  it('restricts generic language requests to the typed feature command', async () => {
    mockedInvoke.mockResolvedValue([])

    await languageClient.request(
      '/home/ada/Proof Garden',
      'Garden/Main.lean',
      'references',
      { line: 3, character: 9 },
    )

    expect(mockedInvoke).toHaveBeenCalledWith('lean_language_request', {
      projectPath: '/home/ada/Proof Garden',
      relativePath: 'Garden/Main.lean',
      feature: 'references',
      line: 3,
      character: 9,
    })
  })

  it('routes infoview RPC calls through a project-scoped native session', async () => {
    mockedInvoke.mockResolvedValueOnce('session-7').mockResolvedValueOnce({ widgets: [] })

    const sessionId = await languageClient.createRpcSession?.(
      '/home/ada/Proof Garden',
      'Garden/Main.lean',
    )
    await languageClient.infoviewRequest?.(
      '/home/ada/Proof Garden',
      'Garden/Main.lean',
      '$/lean/rpc/call',
      { sessionId, method: 'Lean.Widget.getWidgets' },
    )

    expect(mockedInvoke).toHaveBeenNthCalledWith(1, 'create_lean_rpc_session', {
      projectPath: '/home/ada/Proof Garden',
      relativePath: 'Garden/Main.lean',
    })
    expect(mockedInvoke).toHaveBeenNthCalledWith(2, 'lean_infoview_request', {
      projectPath: '/home/ada/Proof Garden',
      relativePath: 'Garden/Main.lean',
      method: '$/lean/rpc/call',
      params: { sessionId: 'session-7', method: 'Lean.Widget.getWidgets' },
    })
  })

  it('does not invoke native commands in browser preview', async () => {
    mockedIsTauri.mockReturnValue(false)

    const status = await languageClient.start('/tmp/project', null)
    const diagnostics = await languageClient.diagnostics('/tmp/project', 'Main.lean')

    expect(status.state).toBe('unavailable')
    expect(diagnostics).toEqual([])
    expect(mockedInvoke).not.toHaveBeenCalled()
  })
})