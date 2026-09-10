import { useEffect, useRef } from 'react'
import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { configureLeanLanguage } from '../editor/leanLanguage'
import {
  applyLeanDiagnostics,
  registerLeanLanguageProviders,
  type LeanLanguageContext,
} from '../editor/leanLsp'
import type { WorkspaceFile } from '../model/workspace'
import { markOnce, performanceMarks } from '../performance'
import type { LspDiagnostic } from '../services/languageClient'

const workerScope = self as typeof self & {
  MonacoEnvironment: { getWorker: () => Worker }
}

workerScope.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}

loader.config({ monaco })

interface LeanEditorProps {
  diagnostics?: LspDiagnostic[]
  file: WorkspaceFile
  languageContext?: LeanLanguageContext | null
  onChange: (content: string) => void
  onCursorChange: (lineNumber: number, column: number) => void
}

export function LeanEditor({
  diagnostics = [],
  file,
  languageContext = null,
  onChange,
  onCursorChange,
}: LeanEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const languageContextRef = useRef(languageContext)

  useEffect(() => {
    languageContextRef.current = languageContext
  }, [languageContext])

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (model && monacoRef.current) {
      applyLeanDiagnostics(monacoRef.current, model, diagnostics)
    }
  }, [diagnostics, file.id])

  function handleBeforeMount(monacoInstance: Monaco) {
    configureLeanLanguage(monacoInstance)
  }

  const handleMount: OnMount = (editor, monacoInstance) => {
    markOnce(performanceMarks.editorReady)
    editorRef.current = editor
    monacoRef.current = monacoInstance
    const providers = registerLeanLanguageProviders(
      monacoInstance,
      () => languageContextRef.current,
    )
    editor.onDidDispose(() => providers.dispose())
    const model = editor.getModel()
    if (model) {
      applyLeanDiagnostics(monacoInstance, model, diagnostics)
    }

    if (import.meta.env.MODE === 'e2e') {
      const revealLine = (event: Event) => {
        const lineNumber = (event as CustomEvent<{ lineNumber?: number }>).detail?.lineNumber
        if (typeof lineNumber !== 'number') {
          return
        }
        editor.setPosition({ lineNumber, column: 1 })
        editor.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Smooth)
        editor.focus()
      }
      window.addEventListener('leanlander:e2e-reveal-line', revealLine)
      editor.onDidDispose(() => {
        window.removeEventListener('leanlander:e2e-reveal-line', revealLine)
      })
    }

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