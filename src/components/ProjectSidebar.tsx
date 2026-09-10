import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Circle, Download, FileCode2, Folder, History, Search, X } from 'lucide-react'
import type { WorkspaceFile } from '../model/workspace'
import type { ServerStatus } from '../services/languageClient'
import type { RecentProject } from '../services/projectClient'
import type { ProjectSearchResult } from '../services/projectClient'
import type { InstallProgress, ToolchainStatus } from '../services/toolchainClient'

interface ProjectSidebarProps {
  activeFileId: string
  files: WorkspaceFile[]
  installProgress: InstallProgress | null
  isSample: boolean
  onCancelToolchainInstall: () => void
  onInstallToolchain: () => void
  onOpenRecent: (path: string) => void
  projectName: string
  projectPath: string
  recentProjects: RecentProject[]
  serverStatus: ServerStatus
  toolchainStatus: ToolchainStatus
  onSelectFile: (fileId: string) => void
  onSearch?: (query: string) => void
  onSelectSearchResult?: (result: ProjectSearchResult) => void
  searchResults?: ProjectSearchResult[]
}

export function ProjectSidebar({
  activeFileId,
  files,
  installProgress,
  isSample,
  onCancelToolchainInstall,
  onInstallToolchain,
  onOpenRecent,
  projectName,
  projectPath,
  recentProjects,
  serverStatus,
  toolchainStatus,
  onSelectFile,
  onSearch,
  onSelectSearchResult,
  searchResults = [],
}: ProjectSidebarProps) {
  const [filter, setFilter] = useState('')
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set())
  const filterRef = useRef<HTMLInputElement>(null)
  const visibleFiles = files.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase()))
  useEffect(() => {
    const focusFilter = () => {
      filterRef.current?.focus()
      filterRef.current?.select()
    }
    window.addEventListener('leanlander:focus-file-filter', focusFilter)
    return () => window.removeEventListener('leanlander:focus-file-filter', focusFilter)
  }, [])
  const repair = toolchainStatus.repairs[0]
  const toolchainLabel = (() => {
    if (installProgress?.running) {
      return installProgress.message
    }

    switch (toolchainStatus.state) {
      case 'checking':
        return 'Checking toolchains'
      case 'ready':
        return toolchainStatus.requiredToolchain ?? toolchainStatus.activeToolchain ?? 'Elan ready'
      case 'missing-elan':
        return 'Elan not found'
      case 'missing-toolchain':
        return `${toolchainStatus.requiredToolchain ?? 'Project toolchain'} missing`
      case 'unavailable':
        return 'Native tools unavailable'
      default:
        return 'Toolchain check failed'
    }
  })()
  const toolchainTone = toolchainStatus.state === 'ready'
    ? ' status-dot--ready'
    : toolchainStatus.state === 'missing-elan' || toolchainStatus.state === 'error'
      ? ' status-dot--error'
      : ' status-dot--amber'
  const serverTone = serverStatus.state === 'ready'
    ? ' status-dot--ready'
    : serverStatus.state === 'error'
      ? ' status-dot--error'
      : serverStatus.state === 'starting'
        ? ' status-dot--amber'
        : ''

  function renderFile(file: WorkspaceFile) {
    const depth = file.path.split('/').length - 1
    return (
      <button
        aria-current={activeFileId === file.id ? 'page' : undefined}
        className="file-row"
        key={file.id}
        onClick={() => onSelectFile(file.id)}
        title={file.path}
        type="button"
        style={{ paddingLeft: 34 + depth * 14 }}
      >
        <FileCode2 aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>{file.name}</span>
      </button>
    )
  }

  const treeRows: React.ReactNode[] = []
  const renderedDirectories = new Set<string>()
  for (const file of visibleFiles) {
    const parts = file.path.split('/')
    let parentCollapsed = false
    for (let index = 0; index < parts.length - 1; index += 1) {
      const directoryPath = parts.slice(0, index + 1).join('/')
      if (!renderedDirectories.has(directoryPath)) {
        renderedDirectories.add(directoryPath)
        const collapsed = collapsedPaths.has(directoryPath) && !filter
        treeRows.push(
          <button
            aria-expanded={!collapsed}
            className="folder-row folder-row--button"
            key={directoryPath}
            onClick={() => setCollapsedPaths((current) => {
              const next = new Set(current)
              if (next.has(directoryPath)) next.delete(directoryPath)
              else next.add(directoryPath)
              return next
            })}
            style={{ paddingLeft: 22 + index * 14 }}
            type="button"
          >
            {collapsed ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
            <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
            <span>{parts[index]}</span>
          </button>,
        )
      }
      parentCollapsed ||= collapsedPaths.has(directoryPath) && !filter
    }
    if (!parentCollapsed) treeRows.push(renderFile(file))
  }

  return (
    <aside aria-label="Project files" className="project-sidebar">
      <div className="sidebar-heading">
        <span>Project</span>
        <span className="sample-label">{isSample ? 'Sample' : 'Local'}</span>
      </div>

      <div className="project-root" title={projectPath}>
        <ChevronDown aria-hidden="true" size={15} />
        <Folder aria-hidden="true" size={16} strokeWidth={1.8} />
        <strong>{projectName}</strong>
      </div>

      <label className="file-filter">
        <Search aria-hidden="true" size={13} />
        <input
          aria-label="Filter project files"
          onChange={(event) => {
            setFilter(event.target.value)
            onSearch?.(event.target.value)
          }}
          placeholder="Filter files"
          type="search"
          value={filter}
          ref={filterRef}
        />
      </label>

      {filter && searchResults.length > 0 && (
        <div aria-label="Project search results" className="search-results">
          {searchResults.map((result) => (
            <button
              className="search-result"
              key={`${result.path}:${result.line}`}
              onClick={() => onSelectSearchResult?.(result)}
              type="button"
            >
              <strong>{result.path}:{result.line}</strong>
              <span>{result.preview}</span>
            </button>
          ))}
        </div>
      )}

      <nav aria-label={`${projectName} files`} className="file-tree">
        {treeRows}
      </nav>

      {recentProjects.length > 0 && (
        <div className="recent-projects">
          <div className="sidebar-heading">Recent</div>
          {recentProjects.slice(0, 4).map((recent) => (
            <button
              className="recent-row"
              disabled={recent.path === projectPath}
              key={recent.path}
              onClick={() => onOpenRecent(recent.path)}
              title={recent.path}
              type="button"
            >
              <History aria-hidden="true" size={14} />
              <span>{recent.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="environment-summary">
        <div className="sidebar-heading">Environment</div>
        <div className="environment-row">
          <Circle
            aria-hidden="true"
            className={`status-dot${toolchainTone}`}
            size={8}
            fill="currentColor"
          />
          <span title={toolchainLabel}>{toolchainLabel}</span>
          {installProgress?.running ? (
            <button
              aria-label="Cancel toolchain installation"
              className="environment-action"
              onClick={onCancelToolchainInstall}
              title="Cancel toolchain installation"
              type="button"
            >
              <X aria-hidden="true" size={13} />
            </button>
          ) : repair?.canRun ? (
            <button
              aria-label={repair.label}
              className="environment-action"
              onClick={onInstallToolchain}
              title={repair.description}
              type="button"
            >
              <Download aria-hidden="true" size={13} />
            </button>
          ) : null}
        </div>
        {repair && !repair.canRun && (
          <div className="environment-detail">{repair.description}</div>
        )}
        <div className="environment-row">
          <Circle
            aria-hidden="true"
            className={`status-dot${serverTone}`}
            size={8}
            fill="currentColor"
          />
          <span title={serverStatus.version ?? serverStatus.message}>{serverStatus.message}</span>
        </div>
      </div>
    </aside>
  )
}