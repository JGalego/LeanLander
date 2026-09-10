import { CheckCircle2, CircleDotDashed, MessageSquareText, Target } from 'lucide-react'
import { proofGoals, type ProofState } from '../model/workspace'
import type { LeanMessage, LspDiagnostic } from '../services/languageClient'

interface ProofPanelProps {
  column: number
  diagnostics?: LspDiagnostic[]
  lineNumber: number
  proofState: ProofState
  processing?: boolean
  messages?: LeanMessage[]
}

export function ProofPanel({
  column,
  diagnostics = [],
  lineNumber,
  proofState,
  processing = false,
  messages = [],
}: ProofPanelProps) {
  const goals = proofGoals(proofState)
  const hasGoal = goals.length > 0

  return (
    <aside aria-label="Proof state" className="proof-panel">
      <header className="proof-header">
        <div>
          <span className="eyebrow">Proof state</span>
          <strong>{goals[0]?.declaration ?? proofState.declaration ?? 'No active declaration'}</strong>
        </div>
        <span className={`goal-count${hasGoal ? '' : ' goal-count--clear'}`}>
          {hasGoal ? `${goals.length} goal${goals.length === 1 ? '' : 's'}` : 'Clear'}
        </span>
      </header>

      <div className="proof-content">
        {processing && !hasGoal ? (
          <div className="proof-empty">
            <CircleDotDashed aria-hidden="true" size={24} strokeWidth={1.6} />
            <strong>Elaborating</strong>
            <span>Lean is still processing this region.</span>
          </div>
        ) : hasGoal ? (
          <>
            {goals.map((goal, index) => (
              <article className="proof-goal" key={`${goal.declaration}-${index}`}>
                <div className="goal-case">{goal.declaration}</div>
                <section className="proof-section">
                  <div className="section-label">
                    <CircleDotDashed aria-hidden="true" size={14} />
                    Context
                  </div>
                  {goal.hypotheses.length > 0 ? (
                    <dl className="hypotheses">
                      {goal.hypotheses.map((hypothesis) => (
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
                    Goal {goals.length > 1 ? index + 1 : ''}
                  </div>
                  <code className="goal-expression">⊢ {goal.target}</code>
                </section>
              </article>
            ))}
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
        <span>
          {diagnostics.length + messages.length === 0
            ? 'No messages'
            : `${diagnostics.length + messages.length} message${diagnostics.length + messages.length === 1 ? '' : 's'}`}
        </span>
      </footer>

      {diagnostics.length + messages.length > 0 && (
        <ol aria-label="Messages" className="messages-list">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.range.start.line}-${diagnostic.range.start.character}-${index}`}>
              <span className={`message-severity message-severity--${diagnostic.severity ?? 1}`}>
                {diagnostic.severity === 1 ? 'Error' : diagnostic.severity === 2 ? 'Warning' : 'Info'}
              </span>
              <span>{diagnostic.message}</span>
              <small>Ln {diagnostic.range.start.line + 1}, Col {diagnostic.range.start.character + 1}</small>
            </li>
          ))}
          {messages.map((message, index) => (
            <li key={`server-${index}-${message.message}`}>
              <span className={`message-severity message-severity--${message.severity}`}>
                {message.severity === 1 ? 'Error' : message.severity === 2 ? 'Warning' : 'Output'}
              </span>
              <span>{message.message}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="proof-position">
        Ln {lineNumber}, Col {column}
      </div>
    </aside>
  )
}