import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleX,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  Stethoscope,
  Wrench,
  X,
} from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import {
  type DoctorClient,
  type DoctorLogs,
  type DoctorReport,
  type DoctorStatus,
} from '../services/doctorClient'
import { errorSummary } from '../services/projectClient'

interface DoctorPanelProps {
  client: DoctorClient
  onClose: () => void
  onRepair: (repairId: string) => Promise<void>
  projectPath: string | null
  requiredToolchain: string | null
}

const statusIcons = {
  ok: CircleCheck,
  warning: CircleAlert,
  error: CircleX,
  unavailable: CircleHelp,
} satisfies Record<DoctorStatus, typeof CircleCheck>

export function DoctorPanel({
  client,
  onClose,
  onRepair,
  projectPath,
  requiredToolchain,
}: DoctorPanelProps) {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [logs, setLogs] = useState<DoctorLogs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [repairing, setRepairing] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    closeRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  useEffect(() => {
    let isCurrent = true
    void client.diagnose(projectPath, requiredToolchain)
      .then((nextReport) => {
        if (isCurrent) {
          setReport(nextReport)
        }
      })
      .catch((diagnosticError) => {
        if (isCurrent) {
          setError(errorSummary(diagnosticError))
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoading(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [client, projectPath, requiredToolchain, revision])

  useEffect(() => {
    if (!showLogs || logs) {
      return
    }
    let isCurrent = true
    void client.logs(projectPath, requiredToolchain)
      .then((nextLogs) => {
        if (isCurrent) {
          setLogs(nextLogs)
        }
      })
      .catch((diagnosticError) => {
        if (isCurrent) {
          setError(errorSummary(diagnosticError))
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsLoadingLogs(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [client, logs, projectPath, requiredToolchain, showLogs])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') {
      return
    }

    const controls = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)'))
      : []
    const firstControl = controls.at(0)
    const lastControl = controls.at(-1)
    if (!firstControl || !lastControl) {
      return
    }
    if (event.shiftKey && document.activeElement === firstControl) {
      event.preventDefault()
      lastControl.focus()
    } else if (!event.shiftKey && document.activeElement === lastControl) {
      event.preventDefault()
      firstControl.focus()
    }
  }

  async function runRepair(repairId: string) {
    setRepairing(repairId)
    setError(null)
    try {
      await onRepair(repairId)
      setLogs(null)
      if (showLogs) {
        setIsLoadingLogs(true)
      }
      setIsLoading(true)
      setRevision((current) => current + 1)
    } catch (repairError) {
      setError(errorSummary(repairError))
    } finally {
      setRepairing(null)
    }
  }

  function refresh() {
    setError(null)
    setIsLoading(true)
    setLogs(null)
    if (showLogs) {
      setIsLoadingLogs(true)
    }
    setRevision((current) => current + 1)
  }

  function toggleLogs() {
    if (!showLogs && !logs) {
      setIsLoadingLogs(true)
    } else if (showLogs) {
      setIsLoadingLogs(false)
    }
    setShowLogs(!showLogs)
  }

  return (
    <div className="dialog-backdrop" onKeyDown={handleKeyDown}>
      <section
        aria-describedby="doctor-description"
        aria-labelledby="doctor-title"
        aria-modal="true"
        className="doctor-panel"
        ref={panelRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <Stethoscope aria-hidden="true" size={18} />
            <h2 id="doctor-title">Lean Doctor</h2>
          </div>
          <div className="doctor-header-actions">
            <button
              aria-label="Refresh diagnostics"
              className="icon-button"
              disabled={isLoading}
              onClick={refresh}
              title="Refresh diagnostics"
              type="button"
            >
              <RefreshCw aria-hidden="true" className={isLoading ? 'spin' : undefined} size={16} />
            </button>
            <button
              aria-label="Close Lean Doctor"
              className="icon-button"
              onClick={onClose}
              ref={closeRef}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </header>

        <div className="doctor-body">
          <p className="doctor-description" id="doctor-description">
            Checks the local Lean environment without changing it.
          </p>

          {isLoading && !report ? (
            <div className="doctor-loading" role="status">
              <LoaderCircle aria-hidden="true" className="spin" size={17} />
              Checking the environment
            </div>
          ) : error && !report ? (
            <div className="doctor-error" role="alert">
              <FileWarning aria-hidden="true" size={17} />
              {error}
            </div>
          ) : (
            <ul aria-live="polite" className="doctor-checks">
              {report?.checks.map((check) => {
                const StatusIcon = statusIcons[check.status]
                const isRepairing = repairing === check.repair?.id
                return (
                  <li className="doctor-check" key={check.id}>
                    <StatusIcon
                      aria-hidden="true"
                      className={`doctor-status doctor-status--${check.status}`}
                      size={17}
                    />
                    <div className="doctor-check-copy">
                      <strong>{check.label}</strong>
                      <span>{check.summary}</span>
                      {check.repair && !check.repair.canRun && (
                        <small>{check.repair.description}</small>
                      )}
                    </div>
                    {check.repair?.canRun && (
                      <button
                        className="doctor-repair"
                        disabled={repairing !== null}
                        onClick={() => void runRepair(check.repair!.id)}
                        title={check.repair.description}
                        type="button"
                      >
                        {isRepairing ? (
                          <LoaderCircle aria-hidden="true" className="spin" size={13} />
                        ) : (
                          <Wrench aria-hidden="true" size={13} />
                        )}
                        {check.repair.label}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {error && report && <p className="doctor-error" role="alert">{error}</p>}

          <div className="doctor-details">
            <button
              aria-expanded={showLogs}
              className="doctor-details-toggle"
              onClick={toggleLogs}
              type="button"
            >
              {isLoadingLogs ? (
                <LoaderCircle aria-hidden="true" className="spin" size={14} />
              ) : (
                <FileWarning aria-hidden="true" size={14} />
              )}
              {showLogs ? 'Hide details' : 'Show details'}
            </button>
            {showLogs && (
              <div className="doctor-log-view">
                <p>Details can contain local project paths. Review them before sharing.</p>
                {logs?.sections.map((section) => (
                  <section key={section.label}>
                    <h3>{section.label}</h3>
                    <pre>{section.content || 'No output captured.'}</pre>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}