import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { configureLeanLanguage } from '../editor/leanLanguage'
import type { WorkspaceFile } from '../model/workspace'

const workerScope = self as typeof self & {
  MonacoEnvironment: { getWorker: () => Worker }
}

workerScope.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

loader.config({ monaco })

interface LeanEditorProps {
  file: WorkspaceFile
  onChange: (content: string) => void
  onCursorChange: (lineNumber: number, column: number) => void
}

export function LeanEditor({ file, onChange, onCursorChange }: LeanEditorProps) {
  function handleBeforeMount(monacoInstance: Monaco) {
    configureLeanLanguage(monacoInstance)
  }

  const handleMount: OnMount = (editor) => {
    if (file.id === 'main') {
      editor.setPosition({ lineNumber: 8, column: 15 })
      onCursorChange(8, 15)
    }

    editor.onDidChangeCursorPosition(({ position }) => {
      onCursorChange(position.lineNumber, position.column)
    })
  }

  return (
    <Editor
      beforeMount={handleBeforeMount}
      defaultLanguage="lean4"
      height="100%"
      language="lean4"
      onChange={(content) => onChange(content ?? '')}
      onMount={handleMount}
      options={{
        automaticLayout: true,
        cursorBlinking: 'smooth',
        fontFamily: "'IBM Plex Mono', monospace",
        fontLigatures: true,
        fontSize: 14,
        glyphMargin: false,
        lineHeight: 23,
        lineNumbersMinChars: 3,
        minimap: { enabled: false },
        overviewRulerBorder: false,
        overviewRulerLanes: 0,
        padding: { top: 18, bottom: 18 },
        renderLineHighlight: 'all',
        roundedSelection: false,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        stickyScroll: { enabled: false },
        tabSize: 2,
        wordWrap: 'on',
      }}
      path={file.path}
      saveViewState
      theme="leanlander"
      value={file.content}
    />
  )
}