import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { DoctorClient, DoctorReport } from '../services/doctorClient'
import { DoctorPanel } from './DoctorPanel'

const report: DoctorReport = {
  status: 'warning',
  checks: [
    {
      id: 'elan',
      label: 'Elan',
      status: 'ok',
      summary: 'Elan 4.2.0 is available.',
      repair: null,
    },
    {
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
    },
  ],
}

function client(): DoctorClient {
  return {
    diagnose: vi.fn().mockResolvedValue(report),
    logs: vi.fn().mockResolvedValue({
      sections: [{ label: 'Lake', content: 'manifest loaded' }],
    }),
  }
}

describe('DoctorPanel', () => {
  it('reports component health and runs explicit repairs', async () => {
    const user = userEvent.setup()
    const doctor = client()
    const onRepair = vi.fn().mockResolvedValue(undefined)
    render(
      <DoctorPanel
        client={doctor}
        onClose={vi.fn()}
        onRepair={onRepair}
        projectPath="/home/ada/Proof Garden"
        requiredToolchain="leanprover/lean4:v4.19.0"
      />,
    )

    expect(await screen.findByText('Elan 4.2.0 is available.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Update dependencies' }))

    expect(onRepair).toHaveBeenCalledWith('update-dependencies')
    expect(doctor.diagnose).toHaveBeenCalledTimes(2)
  })

  it('loads detailed logs only after explicit disclosure', async () => {
    const user = userEvent.setup()
    const doctor = client()
    render(
      <DoctorPanel
        client={doctor}
        onClose={vi.fn()}
        onRepair={vi.fn()}
        projectPath={null}
        requiredToolchain={null}
      />,
    )

    await screen.findByText('Elan 4.2.0 is available.')
    expect(doctor.logs).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Show details' }))

    expect(await screen.findByText('manifest loaded')).toBeInTheDocument()
    expect(doctor.logs).toHaveBeenCalledWith(null, null)
  })

  it('contains focus and restores it when dismissed', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">Doctor</button>
          {open && (
            <DoctorPanel
              client={client()}
              onClose={() => setOpen(false)}
              onRepair={vi.fn()}
              projectPath={null}
              requiredToolchain={null}
            />
          )}
        </>
      )
    }

    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Doctor' })
    await user.click(trigger)
    expect(screen.getByRole('button', { name: 'Close Lean Doctor' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})