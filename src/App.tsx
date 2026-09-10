import { lazy, startTransition, Suspense, useEffect, useState } from 'react'
import {
  Circle,
  FileCode2,
  FolderOpen,
  Hammer,
  LoaderCircle,
  Save,
} from 'lucide-react'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ProofPanel } from './components/ProofPanel'
import {
  proofStateAt,
  sampleWorkspace,
  type WorkspaceFile,
} from './model/workspace'
import {
  errorSummary,
  projectClient,
  type ProjectClient,
  type ProjectMetadata,
  type RecentProject,
} from './services/projectClient'
import {
  projectGateway,
  type ProjectGateway,
} from './services/projectGateway'
import {
  checkingToolchainStatus,
  toolchainClient,
  type InstallProgress,
  type ToolchainClient,
} from './services/toolchainClient'
import leanlanderMark from './assets/leanlander-mark.svg'
import './App.css'

const LeanEditor = lazy(() =>
  import('./components/LeanEditor').then(({ LeanEditor: Component }) => ({
    default: Component,
  })),
)

interface AppProps {
  client?: ProjectClient
  gateway?: ProjectGateway
  toolchains?: ToolchainClient
}

function App({
  client = projectClient,
  gateway = projectGateway,
  toolchains = toolchainClient,
}: AppProps) {
  const [project, setProject] = useState(sampleWorkspace)
  const [files, setFiles] = useState(() => sampleWorkspace.files)
  const [projectMetadata, setProjectMetadata] = useState<ProjectMetadata | null>(null)
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([])
  const [activeFileId, setActiveFileId] = useState('main')
  const [openFileIds, setOpenFileIds] = useState(['main', 'arithmetic'])
  const [dirtyFileIds, setDirtyFileIds] = useState<string[]>([])
  const [cursor, setCursor] = useState({ lineNumber: 8, column: 15 })
  const [isOpening, setIsOpening] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSample, setIsSample] = useState(true)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [toolchainStatus, setToolchainStatus] = useState(checkingToolchainStatus)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)

  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0] ?? null
  const openFiles = openFileIds
    .map((fileId) => files.find((file) => file.id === fileId))
    .filter((file): file is WorkspaceFile => Boolean(file))
  const proofState = proofStateAt(activeFile?.id ?? '', cursor.lineNumber)

  useEffect(() => {
    void client.recentProjects()
      .then(setRecentProjects)
      .catch(() => undefined)
  }, [client])

  useEffect(() => {
    let isCurrent = true
    const requiredToolchain = projectMetadata?.leanToolchain ?? null

    void toolchains.status(requiredToolchain)
      .then((result) => {
        if (isCurrent) {
          setToolchainStatus(result)
        }
      })
      .catch(() => {
        if (isCurrent) {
          setToolchainStatus({
            ...checkingToolchainStatus,
            state: 'error',
            requiredToolchain,
          })
        }
      })

    return () => {
      isCurrent = false
    }
  }, [projectMetadata?.leanToolchain, toolchains])

  function selectFile(fileId: string) {
    setOpenFileIds((current) =>
      current.includes(fileId) ? current : [...current, fileId],
    )
    setActiveFileId(fileId)
    setCursor({ lineNumber: 1, column: 1 })
  }

  function updateActiveFile(content: string) {
    if (!activeFile) {
      return
    }

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

  async function loadProject(path: string) {
    const discovered = await client.discoverProject(path)
    const firstFileId = discovered.files[0]?.id ?? ''

    startTransition(() => {
      setProject({
        name: discovered.metadata.name,
        path: discovered.metadata.path,
        files: discovered.files,
      })
      setFiles(discovered.files)
      setProjectMetadata(discovered.metadata)
      setActiveFileId(firstFileId)
      setOpenFileIds(firstFileId ? [firstFileId] : [])
      setDirtyFileIds([])
      setCursor({ lineNumber: 1, column: 1 })
      setIsSample(false)
      setToolchainStatus({
        ...checkingToolchainStatus,
        requiredToolchain: discovered.metadata.leanToolchain,
      })
      setStatusMessage(
        discovered.metadata.warnings.length > 0
          ? `Opened ${discovered.metadata.name} with ${discovered.metadata.warnings.length} warning${discovered.metadata.warnings.length === 1 ? '' : 's'}`
          : `Opened ${discovered.metadata.name}`,
      )
    })

    try {
      setRecentProjects(await client.recentProjects())
    } catch {
      setRecentProjects([])
    }
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

      await loadProject(selection.path)
    } catch (error) {
      setStatusMessage(errorSummary(error))
    } finally {
      setIsOpening(false)
    }
  }

  async function openRecentProject(path: string) {
    setIsOpening(true)
    setStatusMessage('Opening recent project…')

    try {
      await loadProject(path)
    } catch (error) {
      setStatusMessage(errorSummary(error))
    } finally {
      setIsOpening(false)
    }
  }

  async function saveActiveFile() {
    if (!activeFile || isSample || !dirtyFileIds.includes(activeFile.id)) {
      return
    }

    setIsSaving(true)
    setStatusMessage(`Saving ${activeFile.name}…`)

    try {
      await client.saveFile(project.path, activeFile.path, activeFile.content)
      setDirtyFileIds((current) => current.filter((fileId) => fileId !== activeFile.id))
      setStatusMessage(`Saved ${activeFile.name}`)
    } catch (error) {
      setStatusMessage(errorSummary(error))
    } finally {
      setIsSaving(false)
    }
  }

  async function installRequiredToolchain() {
    const requiredToolchain = toolchainStatus.requiredToolchain
    if (!requiredToolchain) {
      return
    }

    setStatusMessage(`Installing ${requiredToolchain}…`)

    try {
      await toolchains.install(requiredToolchain)

      while (true) {
        const progress = await toolchains.progress()
        setInstallProgress(progress)
        setStatusMessage(progress.message)

        if (!progress.running) {
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 400))
      }

      setToolchainStatus(await toolchains.status(requiredToolchain))
    } catch (error) {
      setStatusMessage(errorSummary(error))
    }
  }

  async function cancelToolchainInstall() {
    try {
      await toolchains.cancel()
      const progress = await toolchains.progress()
      setInstallProgress(progress)
      setStatusMessage(progress.message)
    } catch (error) {
      setStatusMessage(errorSummary(error))
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
          <button
            aria-label="Save file"
            className="toolbar-button"
            disabled={
              isSaving
              || isSample
              || !activeFile
              || !dirtyFileIds.includes(activeFile.id)
            }
            onClick={saveActiveFile}
            title="Save file"
            type="button"
          >
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="spin" size={15} />
            ) : (
              <Save aria-hidden="true" size={15} />
            )}
            Save
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
          installProgress={installProgress}
          isSample={isSample}
          onCancelToolchainInstall={cancelToolchainInstall}
          onInstallToolchain={installRequiredToolchain}
          onOpenRecent={openRecentProject}
          onSelectFile={selectFile}
          projectName={project.name}
          projectPath={project.path}
          recentProjects={recentProjects}
          toolchainStatus={toolchainStatus}
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
            <span className="editor-path">{activeFile?.path}</span>
          </div>

          <div className="editor-surface">
            {activeFile ? (
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
            ) : (
              <div className="editor-loading">
                <FileCode2 aria-hidden="true" size={18} />
                <span>No Lean source files found</span>
              </div>
            )}
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
