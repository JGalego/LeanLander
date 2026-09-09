import { CheckCircle2, CircleDotDashed, MessageSquareText, Target } from 'lucide-react'
import type { ProofState } from '../model/workspace'

interface ProofPanelProps {
  column: number
  lineNumber: number
  proofState: ProofState
}

export function ProofPanel({ column, lineNumber, proofState }: ProofPanelProps) {
  const hasGoal = proofState.goalCount > 0 && proofState.target

  return (
    <aside aria-label="Proof state" className="proof-panel">
      <header className="proof-header">
        <div>
          <span className="eyebrow">Proof state</span>
          <strong>{proofState.declaration}</strong>
        </div>
        <span className={`goal-count${hasGoal ? '' : ' goal-count--clear'}`}>
          {hasGoal ? `${proofState.goalCount} goal` : 'Clear'}
        </span>
      </header>

      <div className="proof-content">
        {hasGoal ? (
          <>
            <section className="proof-section">
              <div className="section-label">
                <CircleDotDashed aria-hidden="true" size={14} />
                Context
              </div>
              {proofState.hypotheses.length > 0 ? (
                <dl className="hypotheses">
                  {proofState.hypotheses.map((hypothesis) => (
                    <div key={hypothesis.name}>
                      <dt>{hypothesis.name}</dt>
                      <dd>{hypothesis.type}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted-copy">No local hypotheses</p>
              )}
            </section>

            <section className="proof-section proof-section--goal">
              <div className="section-label">
                <Target aria-hidden="true" size={14} />
                Goal
              </div>
              <code className="goal-expression">⊢ {proofState.target}</code>
            </section>
          </>
        ) : (
          <div className="proof-empty">
            <CheckCircle2 aria-hidden="true" size={24} strokeWidth={1.6} />
            <strong>No goals here</strong>
            <span>Move the cursor into a proof.</span>
          </div>
        )}
      </div>

      <footer className="messages-summary">
        <div>
          <MessageSquareText aria-hidden="true" size={14} />
          <span>Messages</span>
        </div>
        <span>No messages</span>
      </footer>

      <div className="proof-position">
        Ln {lineNumber}, Col {column}
      </div>
    </aside>
  )
}