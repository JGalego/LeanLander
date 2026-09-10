import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProofPanel } from './ProofPanel'

describe('ProofPanel', () => {
  it('renders Lean trace output in the messages pane', () => {
    render(
      <ProofPanel
        column={1}
        lineNumber={1}
        messages={[{ severity: 3, message: '[trace.Meta.Tactic] closed goal' }]}
        proofState={{ goals: [] }}
      />,
    )

    expect(screen.getByRole('list', { name: 'Messages' })).toHaveTextContent(
      '[trace.Meta.Tactic] closed goal',
    )
  })

  it('leaves info diagnostics such as #check output to editor hovers', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }
    render(
      <ProofPanel
        column={1}
        diagnostics={[
          { range, severity: 3, message: '2 : ℕ' },
          { range, severity: 4, message: 'unused variable hint' },
          { range, severity: 2, message: 'declaration uses sorry' },
        ]}
        lineNumber={1}
        proofState={{ goals: [] }}
      />,
    )

    const list = screen.getByRole('list', { name: 'Messages' })
    expect(list).toHaveTextContent('declaration uses sorry')
    expect(list).not.toHaveTextContent('2 : ℕ')
    expect(list).not.toHaveTextContent('unused variable hint')
    expect(screen.getByText('1 message')).toBeInTheDocument()
  })

  it('shows no messages when only info diagnostics exist', () => {
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }
    render(
      <ProofPanel
        column={1}
        diagnostics={[{ range, severity: 3, message: '17 + 4 : ℕ' }]}
        lineNumber={1}
        proofState={{ goals: [] }}
      />,
    )

    expect(screen.getByText('No messages')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Messages' })).not.toBeInTheDocument()
  })
})
