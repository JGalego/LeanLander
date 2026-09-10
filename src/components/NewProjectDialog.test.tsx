import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { NewProjectDialog } from './NewProjectDialog'

describe('NewProjectDialog', () => {
  it('validates project names with the native service constraints', async () => {
    const user = userEvent.setup()
    const onCreate = vi.fn()
    render(
      <NewProjectDialog
        parentPath="/home/ada/Lean Projects"
        onCancel={vi.fn()}
        onCreate={onCreate}
      />,
    )

    const name = screen.getByLabelText('Project name')
    const create = screen.getByRole('button', { name: 'Create project' })
    expect(name).toHaveAttribute('pattern', '[A-Za-z][A-Za-z0-9_]{0,63}')

    await user.clear(name)
    await user.type(name, '2 bad-name')
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Start with a letter')
    expect(create).toBeDisabled()

    await user.clear(name)
    await user.type(name, 'ProofGarden_2')
    await user.click(screen.getByLabelText('Lean + Mathlib'))
    await user.click(screen.getByLabelText('Initialize Git repository'))
    await user.click(create)

    expect(onCreate).toHaveBeenCalledWith({
      name: 'ProofGarden_2',
      template: 'mathlib',
      initializeGit: false,
    })
  })

  it('contains focus and restores it when dismissed', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">New project</button>
          {open && (
            <NewProjectDialog
              parentPath="/home/ada/Lean Projects"
              onCancel={() => setOpen(false)}
              onCreate={vi.fn()}
            />
          )}
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'New project' })
    await user.click(trigger)

    expect(screen.getByLabelText('Project name')).toHaveFocus()
    const create = screen.getByRole('button', { name: 'Create project' })
    create.focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close new project dialog' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})