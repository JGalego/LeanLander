import { ChevronDown, Circle, FileCode2, Folder } from 'lucide-react'
import type { WorkspaceFile } from '../model/workspace'

interface ProjectSidebarProps {
  activeFileId: string
  files: WorkspaceFile[]
  projectName: string
  projectPath: string
  onSelectFile: (fileId: string) => void
}

export function ProjectSidebar({
  activeFileId,
  files,
  projectName,
  projectPath,
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
        <span className="sample-label">Sample</span>
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
              <span>LeanLander</span>
            </div>
            {sourceFiles.map((file) => renderFile(file, true))}
          </div>
        )}
      </nav>

      <div className="environment-summary">
        <div className="sidebar-heading">Environment</div>
        <div className="environment-row">
          <Circle aria-hidden="true" className="status-dot status-dot--amber" size={8} fill="currentColor" />
          <span>Toolchain pending</span>
        </div>
        <div className="environment-row">
          <Circle aria-hidden="true" className="status-dot" size={8} fill="currentColor" />
          <span>Lean server offline</span>
        </div>
      </div>
    </aside>
  )
}