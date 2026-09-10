import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFile } from './model/workspace'
import type { DoctorClient } from './services/doctorClient'
import type { LanguageClient } from './services/languageClient'
import type { LakeClient } from './services/lakeClient'
import type { ProjectClient } from './services/projectClient'
import type { ProjectGateway } from './services/projectGateway'
import type { ToolchainClient } from './services/toolchainClient'
import App from './App'

vi.mock('./components/LeanEditor', () => ({
  LeanEditor: ({ file }: { file: WorkspaceFile }) => (
    <textarea aria-label="Lean editor" readOnly value={file.content} />
  ),
}))

describe('App', () => {
  it('switches between open Lean files', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('tab', { name: 'Arithmetic.lean' }))

    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Lean editor' }).value)
      .toContain('square_nonnegative')
  })

  it('shows a selected native project', async () => {
    const user = userEvent.setup()
    const gateway: ProjectGateway = {
      chooseProject: vi.fn().mockResolvedValue({
        name: 'Proof Garden',
        path: '/home/ada/Proof Garden',
      }),
      chooseProjectParent: vi.fn(),
    }
    const client: ProjectClient = {
      discoverProject: vi.fn().mockResolvedValue({
        metadata: {
          name: 'Proof Garden',
          path: '/home/ada/Proof Garden',
          leanToolchain: 'leanprover/lean4:v4.19.0',
          lakefile: 'lakefile.toml',
          sourceRoots: ['Garden'],
          warnings: [],
        },
        files: [{
          id: 'Garden/Main.lean',
          name: 'Main.lean',
          path: 'Garden/Main.lean',
          content: 'theorem seed : True := by trivial',
        }],
      }),
      loadFile: vi.fn(),
      saveFile: vi.fn(),
      recentProjects: vi.fn().mockResolvedValue([]),
    }

    render(<App client={client} gateway={gateway} />)
    await user.click(screen.getByRole('button', { name: 'Open project' }))

    expect(await screen.findByText('Opened Proof Garden')).toBeInTheDocument()
    expect(screen.getAllByText('Proof Garden')).toHaveLength(2)
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Lean editor' }).value)
      .toContain('theorem seed')
  })

  it('renders the sample goal at the initial cursor', () => {
    render(<App />)

    expect(screen.getByText('ih')).toBeInTheDocument()
    expect(screen.getByText('⊢ Nat.succ n + 0 = Nat.succ n')).toBeInTheDocument()
  })

  it('opens Lean Doctor and loads details only on request', async () => {
    const user = userEvent.setup()
    const doctor: DoctorClient = {
      diagnose: vi.fn().mockResolvedValue({
        status: 'ok',
        checks: [{
          id: 'elan',
          label: 'Elan',
          status: 'ok',
          summary: 'Elan 4.2.0 is available.',
          repair: null,
        }],
      }),
      logs: vi.fn().mockResolvedValue({
        sections: [{ label: 'Environment', content: 'Elan: 4.2.0' }],
      }),
    }

    render(<App doctor={doctor} />)
    await user.click(screen.getByRole('button', { name: 'Doctor' }))

    expect(await screen.findByText('Elan 4.2.0 is available.')).toBeInTheDocument()
    expect(doctor.diagnose).toHaveBeenCalledWith(null, null)
    expect(doctor.logs).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Show details' }))
    expect(await screen.findByText('Elan: 4.2.0')).toBeInTheDocument()
    expect(doctor.logs).toHaveBeenCalledWith(null, null)
  })

  it('runs a dependency repair through the existing Lake service', async () => {
    const user = userEvent.setup()
    const gateway: ProjectGateway = {
      chooseProject: vi.fn().mockResolvedValue({
        name: 'Proof Garden',
        path: '/home/ada/Proof Garden',
      }),
      chooseProjectParent: vi.fn(),
    }
    const client: ProjectClient = {
      discoverProject: vi.fn().mockResolvedValue({
        metadata: {
          name: 'Proof Garden',
          path: '/home/ada/Proof Garden',
          leanToolchain: 'leanprover/lean4:v4.19.0',
          lakefile: 'lakefile.toml',
          sourceRoots: [],
          warnings: [],
        },
        files: [],
      }),
      loadFile: vi.fn(),
      saveFile: vi.fn(),
      recentProjects: vi.fn().mockResolvedValue([]),
    }
    const lake: LakeClient = {
      create: vi.fn(),
      fetch: vi.fn().mockResolvedValue(undefined),
      build: vi.fn(),
      progress: vi.fn().mockResolvedValue({
        operation: 'fetch',
        stage: 'complete',
        message: 'Dependencies are up to date',
        running: false,
        succeeded: true,
        projectPath: '/home/ada/Proof Garden',
        failure: null,
      }),
      cancel: vi.fn(),
    }
    const doctor: DoctorClient = {
      diagnose: vi.fn().mockResolvedValue({
        status: 'warning',
        checks: [{
          id: 'dependencies',
          label: 'Dependencies',
          status: 'warning',
          summary: 'Dependencies have not been resolved yet.',
          repair: {
            id: 'update-dependencies',
            label: 'Update dependencies',
            description: 'Run Lake update.',
            canRun: true,
          },
        }],
      }),
      logs: vi.fn(),
    }

    render(<App client={client} doctor={doctor} gateway={gateway} lake={lake} />)
    await user.click(screen.getByRole('button', { name: 'Open project' }))
    await screen.findByText('Opened Proof Garden')
    await user.click(screen.getByRole('button', { name: 'Doctor' }))
    await user.click(await screen.findByRole('button', { name: 'Update dependencies' }))

    expect(lake.fetch).toHaveBeenCalledWith(
      '/home/ada/Proof Garden',
      'leanprover/lean4:v4.19.0',
    )
  })

  it('installs a missing project toolchain through the repair action', async () => {
    const user = userEvent.setup()
    const toolchains: ToolchainClient = {
      status: vi.fn().mockResolvedValue({
        state: 'missing-toolchain',
        elanPath: '/home/ada/.elan/bin/elan',
        elanVersion: '4.2.0',
        requiredToolchain: 'leanprover/lean4:v4.19.0',
        activeToolchain: 'leanprover/lean4:v4.18.0',
        installedToolchains: [],
        repairs: [{
          id: 'install-toolchain',
          label: 'Install toolchain',
          description: 'Install the project toolchain.',
          command: ['elan', 'toolchain', 'install', 'leanprover/lean4:v4.19.0'],
          canRun: true,
        }],
      }),
      install: vi.fn().mockResolvedValue(undefined),
      progress: vi.fn().mockResolvedValue({
        stage: 'complete',
        message: 'Installed leanprover/lean4:v4.19.0.',
        running: false,
        succeeded: true,
      }),
      cancel: vi.fn(),
    }

    render(<App toolchains={toolchains} />)
    await user.click(await screen.findByRole('button', { name: 'Install toolchain' }))

    expect(toolchains.install).toHaveBeenCalledWith('leanprover/lean4:v4.19.0')
    expect(await screen.findByText('Installed leanprover/lean4:v4.19.0.')).toBeInTheDocument()
  })

  it('syncs a native document and renders server diagnostics and proof state', async () => {
    const user = userEvent.setup()
    const gateway: ProjectGateway = {
      chooseProject: vi.fn().mockResolvedValue({
        name: 'Proof Garden',
        path: '/home/ada/Proof Garden',
      }),
      chooseProjectParent: vi.fn(),
    }
    const client: ProjectClient = {
      discoverProject: vi.fn().mockResolvedValue({
        metadata: {
          name: 'Proof Garden',
          path: '/home/ada/Proof Garden',
          leanToolchain: 'leanprover/lean4:v4.19.0',
          lakefile: 'lakefile.toml',
          sourceRoots: ['Garden'],
          warnings: [],
        },
        files: [{
          id: 'Garden/Main.lean',
          name: 'Main.lean',
          path: 'Garden/Main.lean',
          content: 'theorem seed : True := by trivial',
        }],
      }),
      loadFile: vi.fn(),
      saveFile: vi.fn(),
      recentProjects: vi.fn().mockResolvedValue([]),
    }
    const toolchains: ToolchainClient = {
      status: vi.fn().mockResolvedValue({
        state: 'ready',
        elanPath: '/home/ada/.elan/bin/elan',
        elanVersion: '4.2.0',
        requiredToolchain: 'leanprover/lean4:v4.19.0',
        activeToolchain: 'leanprover/lean4:v4.19.0',
        installedToolchains: [],
        repairs: [],
      }),
      install: vi.fn(),
      progress: vi.fn(),
      cancel: vi.fn(),
    }
    const language: LanguageClient = {
      start: vi.fn().mockResolvedValue({
        state: 'ready',
        message: 'Lean server ready',
        toolchain: 'leanprover/lean4:v4.19.0',
        version: '4.19.0',
        capabilities: ['diagnostics', 'proofState'],
      }),
      status: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      syncDocument: vi.fn().mockResolvedValue(1),
      closeDocument: vi.fn().mockResolvedValue(undefined),
      diagnostics: vi.fn().mockResolvedValue([{
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 7 },
        },
        severity: 2,
        message: 'declaration uses sorry',
      }]),
      request: vi.fn(),
      proofState: vi.fn().mockResolvedValue({
        declaration: 'Active proof',
        goalCount: 1,
        hypotheses: [],
        target: 'True',
      }),
    }

    render(
      <App
        client={client}
        gateway={gateway}
        language={language}
        toolchains={toolchains}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Open project' }))

    expect(await screen.findByText('Lean server ready')).toBeInTheDocument()
    expect(await screen.findByText('⊢ True')).toBeInTheDocument()
    expect(screen.getByText('1 message')).toBeInTheDocument()
    expect(language.start).toHaveBeenCalledWith(
      '/home/ada/Proof Garden',
      'leanprover/lean4:v4.19.0',
    )
    expect(language.syncDocument).toHaveBeenCalledWith(
      '/home/ada/Proof Garden',
      'Garden/Main.lean',
      'theorem seed : True := by trivial',
      1,
    )
    expect(language.proofState).toHaveBeenCalledWith(
      '/home/ada/Proof Garden',
      'Garden/Main.lean',
      { line: 0, character: 0 },
    )
  })

  it('keeps the editor available while a native Lean server is starting', async () => {
    const user = userEvent.setup()
    const gateway: ProjectGateway = {
      chooseProject: vi.fn().mockResolvedValue({
        name: 'Legacy Course',
        path: '/home/ada/Legacy Course',
      }),
      chooseProjectParent: vi.fn(),
    }
    const client: ProjectClient = {
      discoverProject: vi.fn().mockResolvedValue({
        metadata: {
          name: 'Legacy Course',
          path: '/home/ada/Legacy Course',
          leanToolchain: 'leanprover/lean4:v4.0.0-rc4',
          lakefile: 'lakefile.lean',
          sourceRoots: ['Course'],
          warnings: [],
        },
        files: [{
          id: 'Course/Example.lean',
          name: 'Example.lean',
          path: 'Course/Example.lean',
          content: 'example : True := by trivial',
        }],
      }),
      loadFile: vi.fn(),
      saveFile: vi.fn(),
      recentProjects: vi.fn().mockResolvedValue([]),
    }
    const toolchains: ToolchainClient = {
      status: vi.fn().mockResolvedValue({
        state: 'ready',
        elanPath: '/home/ada/.elan/bin/elan',
        elanVersion: '4.2.0',
        requiredToolchain: 'leanprover/lean4:v4.0.0-rc4',
        activeToolchain: 'leanprover/lean4:v4.0.0-rc4',
        installedToolchains: [],
        repairs: [],
      }),
      install: vi.fn(),
      progress: vi.fn(),
      cancel: vi.fn(),
    }
    const language: LanguageClient = {
      start: vi.fn().mockReturnValue(new Promise(() => undefined)),
      status: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      syncDocument: vi.fn(),
      closeDocument: vi.fn().mockResolvedValue(undefined),
      diagnostics: vi.fn(),
      request: vi.fn(),
      proofState: vi.fn(),
    }

    render(
      <App
        client={client}
        gateway={gateway}
        language={language}
        toolchains={toolchains}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Open project' }))

    expect(await screen.findByText('Waiting to start Lean server')).toBeInTheDocument()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Lean editor' }).value)
      .toContain('example : True')
  })

  it('creates and opens a Mathlib project with optional Git initialization', async () => {
    const user = userEvent.setup()
    const gateway: ProjectGateway = {
      chooseProject: vi.fn(),
      chooseProjectParent: vi.fn().mockResolvedValue({
        name: 'Lean Projects',
        path: '/home/ada/Lean Projects',
      }),
    }
    const client: ProjectClient = {
      discoverProject: vi.fn().mockResolvedValue({
        metadata: {
          name: 'ProofGarden',
          path: '/home/ada/Lean Projects/ProofGarden',
          leanToolchain: 'leanprover/lean4:v4.19.0',
          lakefile: 'lakefile.toml',
          sourceRoots: ['ProofGarden'],
          warnings: [],
        },
        files: [{
          id: 'ProofGarden.lean',
          name: 'ProofGarden.lean',
          path: 'ProofGarden.lean',
          content: 'import Mathlib',
        }],
      }),
      loadFile: vi.fn(),
      saveFile: vi.fn(),
      recentProjects: vi.fn().mockResolvedValue([]),
    }
    const toolchains: ToolchainClient = {
      status: vi.fn().mockResolvedValue({
        state: 'ready',
        elanPath: '/home/ada/.elan/bin/elan',
        elanVersion: '4.2.0',
        requiredToolchain: null,
        activeToolchain: 'leanprover/lean4:v4.19.0',
        installedToolchains: [],
        repairs: [],
      }),
      install: vi.fn(),
      progress: vi.fn(),
      cancel: vi.fn(),
    }
    const lake: LakeClient = {
      create: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      build: vi.fn(),
      progress: vi.fn().mockResolvedValue({
        operation: 'create',
        stage: 'complete',
        message: 'Project created',
        running: false,
        succeeded: true,
        projectPath: '/home/ada/Lean Projects/ProofGarden',
        failure: null,
      }),
      cancel: vi.fn(),
    }
    render(
      <App client={client} gateway={gateway} lake={lake} toolchains={toolchains} />,
    )
    const newProject = screen.getByRole('button', { name: 'New project' })
    await waitFor(() => expect(newProject).toBeEnabled())
    await user.click(newProject)
    const name = await screen.findByLabelText('Project name')
    await user.clear(name)
    await user.type(name, 'ProofGarden')
    await user.click(screen.getByLabelText('Lean + Mathlib'))
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(lake.create).toHaveBeenCalledWith({
      parentPath: '/home/ada/Lean Projects',
      name: 'ProofGarden',
      template: 'mathlib',
      initializeGit: true,
      toolchain: 'leanprover/lean4:v4.19.0',
    })
    expect(await screen.findByText('Opened ProofGarden')).toBeInTheDocument()
  })

  it('preserves creation success when the new project cannot be opened', async () => {
    const user = userEvent.setup()
    const gateway: ProjectGateway = {
      chooseProject: vi.fn(),
      chooseProjectParent: vi.fn().mockResolvedValue({
        name: 'Lean Projects',
        path: '/home/ada/Lean Projects',
      }),
    }
    const client: ProjectClient = {
      discoverProject: vi.fn().mockRejectedValue(new Error('Project folder is unreadable.')),
      loadFile: vi.fn(),
      saveFile: vi.fn(),
      recentProjects: vi.fn().mockResolvedValue([]),
    }
    const lake: LakeClient = {
      create: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn(),
      build: vi.fn(),
      progress: vi.fn().mockResolvedValue({
        operation: 'create',
        stage: 'complete',
        message: 'Project created',
        running: false,
        succeeded: true,
        projectPath: '/home/ada/Lean Projects/ProofGarden',
        failure: null,
      }),
      cancel: vi.fn(),
    }
    const toolchains: ToolchainClient = {
      status: vi.fn().mockResolvedValue({
        state: 'ready',
        elanPath: '/home/ada/.elan/bin/elan',
        elanVersion: '4.2.0',
        requiredToolchain: null,
        activeToolchain: 'leanprover/lean4:v4.19.0',
        installedToolchains: [],
        repairs: [],
      }),
      install: vi.fn(),
      progress: vi.fn(),
      cancel: vi.fn(),
    }

    render(
      <App client={client} gateway={gateway} lake={lake} toolchains={toolchains} />,
    )
    await user.click(screen.getByRole('button', { name: 'New project' }))
    await user.click(await screen.findByRole('button', { name: 'Create project' }))

    expect(await screen.findByText('Project created. Project folder is unreadable.'))
      .toBeInTheDocument()
    expect(lake.progress).toHaveBeenCalled()
  })

  it('cancels an in-flight dependency update', async () => {
    const user = userEvent.setup()
    const gateway: ProjectGateway = {
      chooseProject: vi.fn().mockResolvedValue({
        name: 'Proof Garden',
        path: '/home/ada/Proof Garden',
      }),
      chooseProjectParent: vi.fn(),
    }
    const client: ProjectClient = {
      discoverProject: vi.fn().mockResolvedValue({
        metadata: {
          name: 'Proof Garden',
          path: '/home/ada/Proof Garden',
          leanToolchain: 'leanprover/lean4:v4.19.0',
          lakefile: 'lakefile.toml',
          sourceRoots: [],
          warnings: [],
        },
        files: [],
      }),
      loadFile: vi.fn(),
      saveFile: vi.fn(),
      recentProjects: vi.fn().mockResolvedValue([]),
    }
    const lake: LakeClient = {
      create: vi.fn(),
      fetch: vi.fn().mockResolvedValue(undefined),
      build: vi.fn(),
      progress: vi.fn()
        .mockResolvedValueOnce({
          operation: 'fetch',
          stage: 'fetching',
          message: 'Cloning dependency',
          running: true,
          succeeded: null,
          projectPath: '/home/ada/Proof Garden',
          failure: null,
        })
        .mockResolvedValue({
          operation: 'fetch',
          stage: 'cancelled',
          message: 'Dependency update cancelled',
          running: false,
          succeeded: false,
          projectPath: '/home/ada/Proof Garden',
          failure: null,
        }),
      cancel: vi.fn().mockResolvedValue(undefined),
    }

    render(<App client={client} gateway={gateway} lake={lake} />)
    await user.click(screen.getByRole('button', { name: 'Open project' }))
    await user.click(await screen.findByRole('button', { name: 'Update' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(lake.fetch).toHaveBeenCalledWith(
      '/home/ada/Proof Garden',
      'leanprover/lean4:v4.19.0',
    )
    expect(lake.cancel).toHaveBeenCalledOnce()
    expect(await screen.findByText('Dependency update cancelled')).toBeInTheDocument()
  })
})