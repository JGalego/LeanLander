import { FolderPlus, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ProjectTemplate } from '../services/lakeClient'

export interface NewProjectValues {
  name: string
  template: ProjectTemplate
  initializeGit: boolean
}

interface NewProjectDialogProps {
  parentPath: string
  onCancel: () => void
  onCreate: (values: NewProjectValues) => void
}

export function NewProjectDialog({
  parentPath,
  onCancel,
  onCreate,
}: NewProjectDialogProps) {
  const [name, setName] = useState('MyLeanProject')
  const [template, setTemplate] = useState<ProjectTemplate>('lean')
  const [initializeGit, setInitializeGit] = useState(true)
  const dialogRef = useRef<HTMLElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const validName = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    nameInputRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (validName) {
      onCreate({ name, template, initializeGit })
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') {
      return
    }

    const dialog = dialogRef.current
    const controls = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
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

  return (
    <div className="dialog-backdrop" onKeyDown={handleKeyDown}>
      <section
        aria-describedby="new-project-description"
        aria-labelledby="new-project-title"
        aria-modal="true"
        className="new-project-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <header className="dialog-header">
          <div>
            <FolderPlus aria-hidden="true" size={18} />
            <h2 id="new-project-title">New project</h2>
          </div>
          <button
            aria-label="Close new project dialog"
            className="icon-button"
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <form className="new-project-form" onSubmit={submit}>
          <p className="visually-hidden" id="new-project-description">
            Create a Lake project in the selected location.
          </p>
          <label className="field-label" htmlFor="project-name">Project name</label>
          <input
            aria-describedby={!validName ? 'project-name-error' : undefined}
            aria-invalid={!validName}
            className="text-field"
            id="project-name"
            maxLength={64}
            onChange={(event) => setName(event.target.value)}
            pattern="[A-Za-z][A-Za-z0-9_]{0,63}"
            ref={nameInputRef}
            required
            spellCheck={false}
            value={name}
          />
          {!validName && (
            <p className="field-error" id="project-name-error" role="alert">
              Start with a letter and use only letters, numbers, or underscores.
            </p>
          )}

          <div className="field-label">Location</div>
          <code className="location-field" title={parentPath}>{parentPath}</code>

          <fieldset className="template-fieldset">
            <legend className="field-label">Template</legend>
            <div className="segmented-control">
              <label>
                <input
                  checked={template === 'lean'}
                  name="project-template"
                  onChange={() => setTemplate('lean')}
                  type="radio"
                />
                <span>Lean</span>
              </label>
              <label>
                <input
                  checked={template === 'mathlib'}
                  name="project-template"
                  onChange={() => setTemplate('mathlib')}
                  type="radio"
                />
                <span>Lean + Mathlib</span>
              </label>
            </div>
          </fieldset>

          <label className="checkbox-field">
            <input
              checked={initializeGit}
              onChange={(event) => setInitializeGit(event.target.checked)}
              type="checkbox"
            />
            <span>Initialize Git repository</span>
          </label>

          <footer className="dialog-actions">
            <button className="dialog-button dialog-button--secondary" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="dialog-button dialog-button--primary" disabled={!validName} type="submit">
              Create project
            </button>
          </footer>
        </form>
      </section>
    </div>
  )
}