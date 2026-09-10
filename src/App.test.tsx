import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFile } from './model/workspace'
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
})