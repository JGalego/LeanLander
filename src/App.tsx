import { lazy, startTransition, Suspense, useState } from 'react'
import {
  Circle,
  FileCode2,
  FolderOpen,
  Hammer,
  LoaderCircle,
} from 'lucide-react'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ProofPanel } from './components/ProofPanel'
import {
  proofStateAt,
  sampleWorkspace,
  type WorkspaceFile,
} from './model/workspace'
import {
  projectGateway,
  type ProjectGateway,
} from './services/projectGateway'
import leanlanderMark from './assets/leanlander-mark.svg'
import './App.css'

const LeanEditor = lazy(() =>
  import('./components/LeanEditor').then(({ LeanEditor: Component }) => ({
    default: Component,
  })),
)

interface AppProps {
  gateway?: ProjectGateway
}

function App({ gateway = projectGateway }: AppProps) {
  const [project, setProject] = useState(sampleWorkspace)
  const [files, setFiles] = useState(() => sampleWorkspace.files)
  const [activeFileId, setActiveFileId] = useState('main')
  const [openFileIds, setOpenFileIds] = useState(['main', 'arithmetic'])
  const [dirtyFileIds, setDirtyFileIds] = useState<string[]>([])
  const [cursor, setCursor] = useState({ lineNumber: 8, column: 15 })
  const [isOpening, setIsOpening] = useState(false)
  const [statusMessage, setStatusMessage] = useState('Ready')

  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0]
  const openFiles = openFileIds
    .map((fileId) => files.find((file) => file.id === fileId))
    .filter((file): file is WorkspaceFile => Boolean(file))
  const proofState = proofStateAt(activeFile.id, cursor.lineNumber)

  function selectFile(fileId: string) {
    setOpenFileIds((current) =>
      current.includes(fileId) ? current : [...current, fileId],
    )
    setActiveFileId(fileId)
    setCursor({ lineNumber: 1, column: 1 })
  }

  function updateActiveFile(content: string) {
    setFiles((current) =>
      current.map((file) =>
        file.id === activeFileId ? { ...file, content } : file,
      ),
    )
    setDirtyFileIds((current) =>
      current.includes(activeFileId) ? current : [...current, activeFileId],
    )
    setStatusMessage('Unsaved changes')
  }

  async function openProject() {
    setIsOpening(true)
    setStatusMessage('Choosing a project…')

    try {
      const selection = await gateway.chooseProject()

      if (!selection) {
        setStatusMessage('No project selected')
        return
      }

      startTransition(() => {
        setProject((current) => ({
          ...current,
          name: selection.name,
          path: selection.path,
        }))
        setStatusMessage(`Selected ${selection.name}`)
      })
    } catch {
      setStatusMessage('Could not open the project')
    } finally {
      setIsOpening(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <img alt="" aria-hidden="true" className="brand-mark" src={leanlanderMark} />
          <span>LeanLander</span>
        </div>

        <div className="project-context" title={project.path}>
          <FolderOpen aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>{project.name}</span>
        </div>

        <nav aria-label="Project actions" className="topbar-actions">
          <button className="toolbar-button" disabled={isOpening} onClick={openProject} type="button">
            {isOpening ? (
              <LoaderCircle aria-hidden="true" className="spin" size={15} />
            ) : (
              <FolderOpen aria-hidden="true" size={15} />
            )}
            Open project
          </button>
          <button className="toolbar-button" disabled title="Lake build integration is planned" type="button">
            <Hammer aria-hidden="true" size={15} />
            Build
          </button>
        </nav>
      </header>

      <main className="workspace">
        <ProjectSidebar
          activeFileId={activeFileId}
          files={files}
          onSelectFile={selectFile}
          projectName={project.name}
          projectPath={project.path}
        />

        <section aria-label="Lean editor" className="editor-pane">
          <div aria-label="Open files" className="editor-tabs" role="tablist">
            {openFiles.map((file) => (
              <button
                aria-selected={file.id === activeFileId}
                className="editor-tab"
                key={file.id}
                onClick={() => selectFile(file.id)}
                role="tab"
                type="button"
              >
                <FileCode2 aria-hidden="true" size={14} strokeWidth={1.8} />
                <span>{file.name}</span>
                {dirtyFileIds.includes(file.id) && <span aria-label="Unsaved" className="dirty-dot" />}
              </button>
            ))}
            <span className="editor-path">{activeFile.path}</span>
          </div>

          <div className="editor-surface">
            <Suspense
              fallback={(
                <div className="editor-loading">
                  <LoaderCircle aria-hidden="true" className="spin" size={18} />
                  <span>Loading editor</span>
                </div>
              )}
            >
              <LeanEditor
                file={activeFile}
                onChange={updateActiveFile}
                onCursorChange={(lineNumber, column) => setCursor({ lineNumber, column })}
              />
            </Suspense>
          </div>
        </section>

        <ProofPanel
          column={cursor.column}
          lineNumber={cursor.lineNumber}
          proofState={proofState}
        />
      </main>

      <footer className="statusbar">
        <div className="status-item">
          <Circle aria-hidden="true" className="status-dot status-dot--ready" fill="currentColor" size={7} />
          <span aria-live="polite">{statusMessage}</span>
        </div>
        <div className="status-meta">
          <span>Spaces: 2</span>
          <span>UTF-8</span>
          <span>Lean 4</span>
        </div>
      </footer>
    </div>
  )
}

export default App
