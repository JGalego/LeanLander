import { ChevronDown, Circle, Download, FileCode2, Folder, History, X } from 'lucide-react'
import type { WorkspaceFile } from '../model/workspace'
import type { ServerStatus } from '../services/languageClient'
import type { RecentProject } from '../services/projectClient'
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
}: ProjectSidebarProps) {
  const rootFiles = files.filter((file) => !file.path.includes('/'))
  const sourceFiles = files.filter((file) => file.path.includes('/'))
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

  function renderFile(file: WorkspaceFile, nested = false) {
    return (
      <button
        aria-current={activeFileId === file.id ? 'page' : undefined}
        className={`file-row${nested ? ' file-row--nested' : ''}`}
        key={file.id}
        onClick={() => onSelectFile(file.id)}
        title={file.path}
        type="button"
      >
        <FileCode2 aria-hidden="true" size={15} strokeWidth={1.8} />
        <span>{file.name}</span>
      </button>
    )
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

      <nav aria-label={`${projectName} files`} className="file-tree">
        {rootFiles.map((file) => renderFile(file))}
        {sourceFiles.length > 0 && (
          <div className="source-folder">
            <div className="folder-row">
              <ChevronDown aria-hidden="true" size={14} />
              <Folder aria-hidden="true" size={15} strokeWidth={1.8} />
              <span>Sources</span>
            </div>
            {sourceFiles.map((file) => renderFile(file, true))}
          </div>
        )}
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