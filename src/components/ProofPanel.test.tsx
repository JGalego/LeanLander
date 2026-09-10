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
})
