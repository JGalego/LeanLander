import {
  lazy,
  startTransition,
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import {
  Circle,
  FileCode2,
  FolderPlus,
  FolderOpen,
  Hammer,
  LoaderCircle,
  RefreshCw,
  Save,
  Stethoscope,
  X,
} from 'lucide-react'
import { DoctorPanel } from './components/DoctorPanel'
import { NewProjectDialog, type NewProjectValues } from './components/NewProjectDialog'
import { ProjectSidebar } from './components/ProjectSidebar'
import { ProofPanel } from './components/ProofPanel'
import {
  proofStateAt,
  sampleWorkspace,
  type ProofState,
  type WorkspaceFile,
} from './model/workspace'
import {
  doctorClient,
  type DoctorClient,
} from './services/doctorClient'
import {
  languageClient,
  offlineServerStatus,
  type LanguageClient,
  type DocumentChange,
  type LspDiagnostic,
  type LeanMessage,
  type ServerStatus,
} from './services/languageClient'
import {
  idleLakeProgress,
  lakeClient,
  type LakeClient,
  type LakeProgress,
} from './services/lakeClient'
import {
  errorSummary,
  projectClient,
  type ProjectClient,
  type ProjectMetadata,
  type ProjectSearchResult,
  type RecentProject,
} from './services/projectClient'
import { markOnce, performanceMarks } from './performance'
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
  doctor?: DoctorClient
  gateway?: ProjectGateway
  language?: LanguageClient
  lake?: LakeClient
  toolchains?: ToolchainClient
}

const noProofState: ProofState = {
  declaration: 'No active declaration',
  goalCount: 0,
  hypotheses: [],
}

function App({
  client = projectClient,
  doctor = doctorClient,
  gateway = projectGateway,
  language = languageClient,
  lake = lakeClient,
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
  const [isChoosingParent, setIsChoosingParent] = useState(false)
  const [isStartingLake, setIsStartingLake] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSample, setIsSample] = useState(true)
  const [statusMessage, setStatusMessage] = useState('Ready')
  const [toolchainStatus, setToolchainStatus] = useState(checkingToolchainStatus)
  const [installProgress, setInstallProgress] = useState<InstallProgress | null>(null)
  const [lakeProgress, setLakeProgress] = useState<LakeProgress | null>(null)
  const [newProjectParent, setNewProjectParent] = useState<string | null>(null)
  const [showDoctor, setShowDoctor] = useState(false)
  const [serverStatus, setServerStatus] = useState<ServerStatus>(offlineServerStatus)
  const [nativeProofState, setNativeProofState] = useState<ProofState>(noProofState)
  const [diagnostics, setDiagnostics] = useState<LspDiagnostic[]>([])
  const [isElaborating, setIsElaborating] = useState(false)
  const [serverMessages, setServerMessages] = useState<LeanMessage[]>([])
  const [syncedDocument, setSyncedDocument] = useState<string | null>(null)
  const [searchResults, setSearchResults] = useState<ProjectSearchResult[]>([])
  const [revealPosition, setRevealPosition] = useState<{ lineNumber: number; column: number } | null>(null)
  const documentVersions = useRef(new Map<string, number>())
  const pendingDocumentChanges = useRef(new Map<string, DocumentChange[]>())
  const documentDiagnostics = useRef(new Map<string, LspDiagnostic[]>())
  const documentProofStates = useRef(new Map<string, ProofState>())
  const serverLeases = useRef(new Map<string, number>())
  const projectLoadGeneration = useRef(0)

  useEffect(() => {
    markOnce(performanceMarks.appReady)
  }, [])

  const handleAccelerator = useEffectEvent((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 's' && !event.shiftKey) {
      event.preventDefault()
      void saveActiveFile()
    } else if (key === 'p' && !event.shiftKey) {
      event.preventDefault()
      window.dispatchEvent(new CustomEvent('leanlander:focus-file-filter'))
    } else if (key === 'f' && event.shiftKey) {
      event.preventDefault()
      window.dispatchEvent(new CustomEvent('leanlander:focus-file-filter'))
    } else if (key === 'd' && event.shiftKey) {
      event.preventDefault()
      setShowDoctor(true)
    }
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleAccelerator(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  const activeFile = files.find((file) => file.id === activeFileId) ?? files[0] ?? null
  const activeFilePath = activeFile?.path ?? null
  const openFiles = openFileIds
    .map((fileId) => files.find((file) => file.id === fileId))
    .filter((file): file is WorkspaceFile => Boolean(file))
  const proofState = isSample
    ? proofStateAt(activeFile?.id ?? '', cursor.lineNumber)
    : nativeProofState
  const receiveLakeProgress = useEffectEvent(async (progress: LakeProgress) => {
    setLakeProgress(progress)
    setStatusMessage(
      progress.failure
        ? `${progress.failure.summary} ${progress.failure.suggestion}`
        : progress.message,
    )

    if (progress.succeeded && progress.operation === 'create' && progress.projectPath) {
      try {
        const opened = await loadProject(progress.projectPath)
        if (!opened) {
          return
        }
      } catch (error) {
        setStatusMessage(`Project created. ${errorSummary(error)}`)
      }
    }
  })

  useEffect(() => {
    void client.recentProjects()
      .then(setRecentProjects)
      .catch(() => undefined)
  }, [client])

  useEffect(() => () => {
    projectLoadGeneration.current += 1
  }, [])

  useEffect(() => {
    let isCurrent = true
    const requiredToolchain = projectMetadata?.leanToolchain ?? null

    void toolchains.status(requiredToolchain)
      .then((result) => {
        if (isCurrent) {
          setToolchainStatus(result)
          if (result.state !== 'ready') {
            setServerStatus({
              ...offlineServerStatus,
              state: result.state === 'unavailable' ? 'unavailable' : 'offline',
              message: result.state === 'unavailable'
                ? 'Native Lean server unavailable in browser preview'
                : 'Lean server waiting for toolchain',
            })
          }
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

  useEffect(() => {
    if (isSample || toolchainStatus.state !== 'ready') {
      return
    }

    let isCurrent = true
    const projectPath = project.path
    const leases = serverLeases.current
    const lease = (leases.get(projectPath) ?? 0) + 1
    leases.set(projectPath, lease)
    void language.start(projectPath, projectMetadata?.leanToolchain ?? null)
      .then((status) => {
        if (isCurrent) {
          setServerStatus(status)
        }
      })
      .catch((error) => {
        if (isCurrent) {
          setServerStatus({
            ...offlineServerStatus,
            state: 'error',
            message: errorSummary(error),
            toolchain: projectMetadata?.leanToolchain ?? null,
          })
        }
      })

    return () => {
      isCurrent = false
      queueMicrotask(() => {
        if (leases.get(projectPath) === lease) {
          leases.delete(projectPath)
          void language.stop(projectPath)
        }
      })
    }
  }, [isSample, language, project.path, projectMetadata?.leanToolchain, toolchainStatus.state])

  useEffect(() => {
    if (isSample || serverStatus.state !== 'ready' || !activeFile) {
      return
    }

    let isCurrent = true
    const key = `${project.path}\0${activeFile.path}`
    if (documentVersions.current.has(key) && !pendingDocumentChanges.current.has(key)) {
      setSyncedDocument(key)
      return
    }
    const timeout = window.setTimeout(() => {
      const version = (documentVersions.current.get(key) ?? 0) + 1
      const changes = pendingDocumentChanges.current.get(key)
      pendingDocumentChanges.current.delete(key)
      const sync = changes && documentVersions.current.has(key)
        ? language.syncDocument(project.path, activeFile.path, activeFile.content, version, changes)
        : language.syncDocument(project.path, activeFile.path, activeFile.content, version)
      void sync.then((acceptedVersion) => {
        documentVersions.current.set(key, acceptedVersion)
        if (isCurrent) {
          setSyncedDocument(key)
        }
      }).catch((error) => {
        if (isCurrent) {
          setStatusMessage(errorSummary(error))
        }
      })
    }, 120)

    return () => {
      isCurrent = false
      window.clearTimeout(timeout)
    }
  }, [activeFile, isSample, language, project.path, serverStatus.state])

  useEffect(() => {
    if (isSample || serverStatus.state !== 'ready' || !activeFilePath) {
      return
    }
    const key = `${project.path}\0${activeFilePath}`
    if (syncedDocument !== key) {
      return
    }

    let isCurrent = true
    const accept = (uri: string, items: LspDiagnostic[]) => {
      if (!isCurrent || !decodeURIComponent(uri).endsWith(`/${activeFilePath}`)) return
      setDiagnostics(items)
      documentDiagnostics.current.set(key, items)
    }
    void language.diagnostics(project.path, activeFilePath)
      .then((items) => accept(`/${activeFilePath}`, items))
      .catch(() => undefined)
    let unlisten: (() => void) | undefined
    const subscribe = import.meta.env.MODE === 'e2e' ? undefined : language.onDiagnostics
    void subscribe?.(({ uri, diagnostics: items }) => accept(uri, items))
      .then((dispose) => { unlisten = dispose })

    return () => {
      isCurrent = false
      unlisten?.()
    }
  }, [activeFilePath, isSample, language, project.path, serverStatus.state, syncedDocument])

  useEffect(() => {
    if (!activeFilePath || !language.onFileProgress || import.meta.env.MODE === 'e2e') return
    let unlisten: (() => void) | undefined
    void language.onFileProgress((progress) => {
      const uri = progress.textDocument?.uri
      if (!uri || !decodeURIComponent(uri).endsWith(`/${activeFilePath}`)) return
      setIsElaborating((progress.processing?.length ?? 0) > 0)
    }).then((dispose) => { unlisten = dispose })
    return () => unlisten?.()
  }, [activeFilePath, language])

  useEffect(() => {
    if (!language.onMessage || import.meta.env.MODE === 'e2e') return
    let unlisten: (() => void) | undefined
    void language.onMessage((message) => {
      setServerMessages((current) => [...current.slice(-99), message])
    }).then((dispose) => { unlisten = dispose })
    return () => unlisten?.()
  }, [language])

  useEffect(() => {
    if (isSample || serverStatus.state !== 'ready' || !activeFilePath) {
      return
    }
    const key = `${project.path}\0${activeFilePath}`
    if (syncedDocument !== key) {
      return
    }

    let isCurrent = true
    const timeout = window.setTimeout(() => {
      void language.proofState(project.path, activeFilePath, {
        line: Math.max(0, cursor.lineNumber - 1),
        character: Math.max(0, cursor.column - 1),
      }).then((state) => {
        if (isCurrent) {
          setNativeProofState(state)
            documentProofStates.current.set(key, state)
        }
      }).catch(() => {
        if (isCurrent) {
          setNativeProofState(noProofState)
        }
      })
    }, 100)

    return () => {
      isCurrent = false
      window.clearTimeout(timeout)
    }
  }, [activeFilePath, cursor, isSample, language, project.path, serverStatus.state, syncedDocument])

  useEffect(() => {
    if (lake.onProgress && import.meta.env.MODE !== 'e2e') {
      let unlisten: (() => void) | undefined
      void lake.onProgress((progress) => void receiveLakeProgress(progress))
        .then((dispose) => { unlisten = dispose })
      return () => unlisten?.()
    }
    if (!lakeProgress?.running) return

    let current = true
    let timeout: number | undefined
    const poll = async () => {
      const progress = await lake.progress()
      if (!current) return
      await receiveLakeProgress(progress)
      if (current && progress.running) timeout = window.setTimeout(poll, 300)
    }
    void poll().catch((error) => setStatusMessage(errorSummary(error)))
    return () => {
      current = false
      if (timeout !== undefined) window.clearTimeout(timeout)
    }
  }, [lake, lakeProgress?.running])

  async function selectFile(fileId: string) {
    const selected = files.find((file) => file.id === fileId)
    if (selected?.loaded === false) {
      try {
        const loaded = await client.loadFile(project.path, selected.path)
        setFiles((current) => current.map((file) => file.id === fileId ? loaded : file))
      } catch (error) {
        setStatusMessage(errorSummary(error))
        return
      }
    }
    setOpenFileIds((current) => {
      if (current.includes(fileId)) return current
      const next = [...current, fileId]
      if (next.length <= 12) return next
      const evicted = next.find((id) => id !== fileId && !dirtyFileIds.includes(id))
      if (!evicted) return next
      const evictedFile = files.find((file) => file.id === evicted)
      if (evictedFile && !isSample) {
        void language.closeDocument(project.path, evictedFile.path).catch(() => undefined)
        const key = `${project.path}\0${evictedFile.path}`
        documentVersions.current.delete(key)
        documentDiagnostics.current.delete(key)
        documentProofStates.current.delete(key)
      }
      return next.filter((id) => id !== evicted)
    })
    setActiveFileId(fileId)
    setCursor({ lineNumber: 1, column: 1 })
    const key = selected ? `${project.path}\0${selected.path}` : ''
    setDiagnostics(documentDiagnostics.current.get(key) ?? [])
    setNativeProofState(documentProofStates.current.get(key) ?? noProofState)
    setSyncedDocument(null)
    setRevealPosition(null)
  }

  async function openLocation(uri: string, range: { start: { line: number; character: number } }) {
    if (!client.loadUri) return
    try {
      const loaded = await client.loadUri(project.path, uri)
      setFiles((current) => current.some((file) => file.id === loaded.id)
        ? current.map((file) => file.id === loaded.id ? loaded : file)
        : [...current, loaded])
      setOpenFileIds((current) => current.includes(loaded.id) ? current : [...current, loaded.id])
      setActiveFileId(loaded.id)
      setRevealPosition({ lineNumber: range.start.line + 1, column: range.start.character + 1 })
      setStatusMessage(`Opened ${loaded.path}${loaded.readOnly ? ' read-only' : ''}`)
    } catch (error) {
      setStatusMessage(errorSummary(error))
    }
  }

  async function searchProject(query: string) {
    if (!client.search || isSample || query.trim().length < 2) {
      setSearchResults([])
      return
    }
    setSearchResults(await client.search(project.path, query).catch(() => []))
  }

  async function openSearchResult(result: ProjectSearchResult) {
    await selectFile(result.path)
    setRevealPosition({ lineNumber: result.line, column: 1 })
  }

  function updateActiveFile(content: string, changes: DocumentChange[] = []) {
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
    const key = `${project.path}\0${activeFile.path}`
    pendingDocumentChanges.current.set(key, [
      ...(pendingDocumentChanges.current.get(key) ?? []),
      ...changes,
    ])
    setSyncedDocument(null)
  }

  async function loadProject(path: string) {
    const generation = projectLoadGeneration.current + 1
    projectLoadGeneration.current = generation
    let discovered
    try {
      discovered = await client.discoverProject(path)
    } catch (error) {
      if (projectLoadGeneration.current !== generation) {
        return false
      }
      throw error
    }
    if (projectLoadGeneration.current !== generation) {
      return false
    }
    const firstDescriptor = discovered.files[0]
    const firstFile = firstDescriptor?.loaded === false
      ? await client.loadFile(discovered.metadata.path, firstDescriptor.path)
      : firstDescriptor
    const discoveredFiles = firstFile
      ? discovered.files.map((file) => file.id === firstFile.id ? firstFile : file)
      : discovered.files
    const firstFileId = firstFile?.id ?? ''

    startTransition(() => {
      setProject({
        name: discovered.metadata.name,
        path: discovered.metadata.path,
        files: discoveredFiles,
      })
      setFiles(discoveredFiles)
      setProjectMetadata(discovered.metadata)
      setActiveFileId(firstFileId)
      setOpenFileIds(firstFileId ? [firstFileId] : [])
      setDirtyFileIds([])
      setCursor({ lineNumber: 1, column: 1 })
      setIsSample(false)
      documentVersions.current.clear()
      pendingDocumentChanges.current.clear()
      documentDiagnostics.current.clear()
      documentProofStates.current.clear()
      setDiagnostics([])
      setServerMessages([])
      setNativeProofState(noProofState)
      setSyncedDocument(null)
      setServerStatus({
        ...offlineServerStatus,
        state: 'starting',
        message: 'Waiting to start Lean server',
        toolchain: discovered.metadata.leanToolchain,
      })
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
      const recent = await client.recentProjects()
      if (projectLoadGeneration.current === generation) {
        setRecentProjects(recent)
      }
    } catch {
      if (projectLoadGeneration.current === generation) {
        setRecentProjects([])
      }
    }
    return true
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

  async function installRequiredToolchain(): Promise<string | null> {
    const requiredToolchain = toolchainStatus.requiredToolchain
    if (!requiredToolchain) {
      return 'No project toolchain is selected.'
    }

    setStatusMessage(`Installing ${requiredToolchain}…`)

    try {
      let finalProgress: InstallProgress | null = null
      if (toolchains.onProgress && import.meta.env.MODE !== 'e2e') {
        finalProgress = await new Promise<InstallProgress>((resolve, reject) => {
          let unlisten: (() => void) | undefined
          void toolchains.onProgress?.((progress) => {
            setInstallProgress(progress)
            setStatusMessage(progress.message)
            if (!progress.running) {
              unlisten?.()
              resolve(progress)
            }
          }).then((dispose) => {
            unlisten = dispose
            return toolchains.install(requiredToolchain)
          }).catch(reject)
        })
      } else {
        await toolchains.install(requiredToolchain)
        while (true) {
          const progress = await toolchains.progress()
          setInstallProgress(progress)
          setStatusMessage(progress.message)
          if (!progress.running) {
            finalProgress = progress
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 400))
        }
      }

      setToolchainStatus(await toolchains.status(requiredToolchain))
      return finalProgress?.succeeded === false ? finalProgress.message : null
    } catch (error) {
      const message = errorSummary(error)
      setStatusMessage(message)
      return message
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

  async function chooseNewProjectParent() {
    setIsChoosingParent(true)
    setStatusMessage('Choosing a project location…')

    try {
      const selection = await gateway.chooseProjectParent()
      if (selection) {
        setNewProjectParent(selection.path)
        setStatusMessage('Ready to create project')
      } else {
        setStatusMessage('No project location selected')
      }
    } catch (error) {
      setStatusMessage(errorSummary(error))
    } finally {
      setIsChoosingParent(false)
    }
  }

  async function createProject(values: NewProjectValues) {
    if (!newProjectParent) {
      return
    }
    const parentPath = newProjectParent
    setNewProjectParent(null)
    setIsStartingLake(true)
    setStatusMessage(`Creating ${values.name}…`)

    try {
      await lake.create({
        parentPath,
        ...values,
        toolchain: toolchainStatus.requiredToolchain ?? toolchainStatus.activeToolchain,
      })
      setLakeProgress({
        ...idleLakeProgress,
        operation: 'create',
        stage: 'creating',
        message: `Creating ${values.name}`,
        running: true,
      })
    } catch (error) {
      setLakeProgress(null)
      setStatusMessage(errorSummary(error))
    } finally {
      setIsStartingLake(false)
    }
  }

  async function fetchDependencies(): Promise<string | null> {
    setIsStartingLake(true)
    setStatusMessage('Updating project dependencies…')

    try {
      await lake.fetch(project.path, projectMetadata?.leanToolchain ?? null)
      setLakeProgress({
        ...idleLakeProgress,
        operation: 'fetch',
        stage: 'fetching',
        message: 'Updating project dependencies',
        running: true,
        projectPath: project.path,
      })
      return null
    } catch (error) {
      const message = errorSummary(error)
      setLakeProgress(null)
      setStatusMessage(message)
      return message
    } finally {
      setIsStartingLake(false)
    }
  }

  async function buildProject() {
    setIsStartingLake(true)
    setStatusMessage('Building project…')

    try {
      await lake.build(project.path, projectMetadata?.leanToolchain ?? null)
      setLakeProgress({
        ...idleLakeProgress,
        operation: 'build',
        stage: 'building',
        message: 'Building project',
        running: true,
        projectPath: project.path,
      })
    } catch (error) {
      setLakeProgress(null)
      setStatusMessage(errorSummary(error))
    } finally {
      setIsStartingLake(false)
    }
  }

  async function cancelLakeOperation() {
    try {
      await lake.cancel()
      const progress = await lake.progress()
      setLakeProgress(progress)
      setStatusMessage(progress.message)
    } catch (error) {
      setStatusMessage(errorSummary(error))
    }
  }

  async function restartLeanServer() {
    if (isSample) {
      return
    }
    setStatusMessage('Restarting Lean server…')
    setServerStatus({
      ...offlineServerStatus,
      state: 'starting',
      message: 'Restarting Lean server',
      toolchain: projectMetadata?.leanToolchain ?? null,
    })
    try {
      await language.stop(project.path)
      const status = await language.start(
        project.path,
        projectMetadata?.leanToolchain ?? null,
      )
      setServerStatus(status)
      setStatusMessage(status.message)
    } catch (error) {
      const message = errorSummary(error)
      setServerStatus({
        ...offlineServerStatus,
        state: 'error',
        message,
        toolchain: projectMetadata?.leanToolchain ?? null,
      })
      setStatusMessage(message)
      throw error
    }
  }

  async function runDoctorRepair(repairId: string) {
    switch (repairId) {
      case 'install-toolchain':
        {
          const error = await installRequiredToolchain()
          if (error) {
            throw new Error(error)
          }
        }
        return
      case 'update-dependencies':
        {
          const error = await fetchDependencies()
          if (error) {
            throw new Error(error)
          }
        }
        return
      case 'restart-server':
        await restartLeanServer()
        return
      default:
        throw new Error('This repair requires a manual action.')
    }
  }

  const lakeRunning = isStartingLake || Boolean(lakeProgress?.running)
  const hasLakeProject = !isSample && Boolean(projectMetadata?.lakefile)
  const canCreateProject = toolchainStatus.state === 'ready' && !lakeRunning
  const canRunLake = hasLakeProject && !lakeRunning

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
          <button
            className="toolbar-button"
            disabled={!canCreateProject || isChoosingParent}
            onClick={chooseNewProjectParent}
            title={canCreateProject ? 'Create project' : 'A ready Lean toolchain is required'}
            type="button"
          >
            {isChoosingParent ? (
              <LoaderCircle aria-hidden="true" className="spin" size={15} />
            ) : (
              <FolderPlus aria-hidden="true" size={15} />
            )}
            New project
          </button>
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
          <button
            className="toolbar-button"
            disabled={!canRunLake}
            onClick={fetchDependencies}
            title={hasLakeProject ? 'Update dependencies' : 'Open a Lake project to update dependencies'}
            type="button"
          >
            <RefreshCw aria-hidden="true" size={15} />
            Update
          </button>
          <button
            className="toolbar-button"
            disabled={!canRunLake || dirtyFileIds.length > 0}
            onClick={buildProject}
            title={dirtyFileIds.length > 0 ? 'Save changes before building' : 'Build project'}
            type="button"
          >
            <Hammer aria-hidden="true" size={15} />
            Build
          </button>
          <button
            className="toolbar-button"
            onClick={() => setShowDoctor(true)}
            title="Diagnose Lean environment"
            type="button"
          >
            <Stethoscope aria-hidden="true" size={15} />
            Doctor
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
          onSearch={searchProject}
          onSelectSearchResult={openSearchResult}
          projectName={project.name}
          projectPath={project.path}
          recentProjects={recentProjects}
          serverStatus={serverStatus}
          searchResults={searchResults}
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
                  diagnostics={diagnostics}
                  file={activeFile}
                  languageContext={
                    !isSample && serverStatus.state === 'ready'
                      ? {
                          client: language,
                          projectPath: project.path,
                          relativePath: activeFile.path,
                          openLocation,
                        }
                      : null
                  }
                  onChange={updateActiveFile}
                  onCursorChange={(lineNumber, column) => setCursor({ lineNumber, column })}
                  revealPosition={revealPosition}
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
          diagnostics={diagnostics}
          messages={serverMessages}
          lineNumber={cursor.lineNumber}
          proofState={proofState}
          processing={isElaborating}
        />
      </main>

      <footer className="statusbar">
        <div className="status-item">
          <Circle aria-hidden="true" className="status-dot status-dot--ready" fill="currentColor" size={7} />
          <span aria-live="polite">{statusMessage}</span>
          {lakeRunning && (
            <button
              className="status-cancel"
              onClick={cancelLakeOperation}
              type="button"
            >
              <X aria-hidden="true" size={11} />
              Cancel
            </button>
          )}
        </div>
        <div className="status-meta">
          <span>Spaces: 2</span>
          <span>UTF-8</span>
          <span>Lean 4</span>
        </div>
      </footer>

      {newProjectParent && (
        <NewProjectDialog
          onCancel={() => setNewProjectParent(null)}
          onCreate={createProject}
          parentPath={newProjectParent}
        />
      )}
      {showDoctor && (
        <DoctorPanel
          client={doctor}
          onClose={() => setShowDoctor(false)}
          onRepair={runDoctorRepair}
          projectPath={isSample ? null : project.path}
          requiredToolchain={projectMetadata?.leanToolchain ?? null}
        />
      )}
    </div>
  )
}

export default App
