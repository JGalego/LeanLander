import { ChevronDown, Circle, FileCode2, Folder, History } from 'lucide-react'
import type { WorkspaceFile } from '../model/workspace'
import type { RecentProject } from '../services/projectClient'

interface ProjectSidebarProps {
  activeFileId: string
  files: WorkspaceFile[]
  isSample: boolean
  onOpenRecent: (path: string) => void
  projectName: string
  projectPath: string
  recentProjects: RecentProject[]
  toolchain?: string | null
  onSelectFile: (fileId: string) => void
}

export function ProjectSidebar({
  activeFileId,
  files,
  isSample,
  onOpenRecent,
  projectName,
  projectPath,
  recentProjects,
  toolchain,
  onSelectFile,
}: ProjectSidebarProps) {
  const rootFiles = files.filter((file) => !file.path.includes('/'))
  const sourceFiles = files.filter((file) => file.path.includes('/'))

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
            className={`status-dot${toolchain ? ' status-dot--ready' : ' status-dot--amber'}`}
            size={8}
            fill="currentColor"
          />
          <span>{toolchain ?? (isSample ? 'Toolchain not checked' : 'Toolchain file missing')}</span>
        </div>
        <div className="environment-row">
          <Circle aria-hidden="true" className="status-dot" size={8} fill="currentColor" />
          <span>Lean server offline</span>
        </div>
      </div>
    </aside>
  )
}