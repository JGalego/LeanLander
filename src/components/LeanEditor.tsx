import { useEffect, useRef, useState } from 'react'
import Editor, { loader, type Monaco, type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { configureLeanLanguage } from '../editor/leanLanguage'
import {
  applyLeanDiagnostics,
  registerLeanLanguageProviders,
  type LeanLanguageContext,
} from '../editor/leanLsp'
import { findLeanAbbreviation } from '../editor/leanAbbreviations'
import type { WorkspaceFile } from '../model/workspace'
import { markOnce, performanceMarks } from '../performance'
import type { LspDiagnostic } from '../services/languageClient'
import type { DocumentChange } from '../services/languageClient'

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
  onChange: (content: string, changes: DocumentChange[]) => void
  onCursorChange: (lineNumber: number, column: number) => void
  revealPosition?: { lineNumber: number; column: number } | null
}

export function LeanEditor({
  diagnostics = [],
  file,
  languageContext = null,
  onChange,
  onCursorChange,
  revealPosition = null,
}: LeanEditorProps) {
  const [darkAppearance, setDarkAppearance] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)
  const languageContextRef = useRef(languageContext)

  useEffect(() => {
    languageContextRef.current = languageContext
  }, [languageContext])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setDarkAppearance(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (model && monacoRef.current) {
      applyLeanDiagnostics(monacoRef.current, model, diagnostics)
    }
  }, [diagnostics, file.id])

  useEffect(() => {
    if (!revealPosition || !editorRef.current) return
    editorRef.current.setPosition(revealPosition)
    editorRef.current.revealPositionInCenter(revealPosition)
    editorRef.current.focus()
  }, [file.id, revealPosition])

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

    const expandAbbreviation = (
      triggerLength = 0,
      changedPosition?: { lineNumber: number; column: number },
    ) => {
      const position = changedPosition ?? editor.getPosition()
      const activeModel = editor.getModel()
      if (!position || !activeModel) {
        return false
      }

      const linePrefix = activeModel.getLineContent(position.lineNumber)
        .slice(0, position.column - 1)
      const match = findLeanAbbreviation(linePrefix, triggerLength)
      if (!match) {
        return false
      }

      editor.pushUndoStop()
      editor.executeEdits('lean-unicode-input', [{
        range: new monacoInstance.Range(
          position.lineNumber,
          match.startColumn,
          position.lineNumber,
          match.endColumn,
        ),
        text: match.replacement,
        forceMoveMarkers: true,
      }])
      editor.pushUndoStop()
      if (match.cursorOffset !== undefined) {
        editor.setPosition({
          lineNumber: position.lineNumber,
          column: match.startColumn + match.cursorOffset,
        })
      }
      return true
    }

    editor.onDidChangeModelContent(({ changes }) => {
      if (changes.length !== 1) {
        return
      }
      const text = changes[0].text
      if (/^[\s,;:.)\]}]$/.test(text)) {
        expandAbbreviation(text.length, {
          lineNumber: changes[0].range.startLineNumber,
          column: changes[0].range.startColumn + text.length,
        })
      }
    })
    editor.addCommand(monacoInstance.KeyCode.Tab, () => {
      if (!expandAbbreviation()) {
        editor.trigger('keyboard', 'tab', null)
      }
    })

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

    const insertText = (event: Event) => {
      const detail = (event as CustomEvent<{
        text?: string
        kind?: 'here' | 'above'
        position?: { line: number; character: number }
      }>).detail
      if (typeof detail?.text !== 'string') return
      const requested = detail.position
        ? { lineNumber: detail.position.line + 1, column: detail.position.character + 1 }
        : editor.getPosition()
      if (!requested) return
      const position = detail.kind === 'above'
        ? { lineNumber: Math.max(1, requested.lineNumber - 1), column: 1 }
        : requested
      editor.executeEdits('lean-infoview', [{ range: new monacoInstance.Range(
        position.lineNumber,
        position.column,
        position.lineNumber,
        position.column,
      ), text: detail.text }])
      editor.focus()
    }
    window.addEventListener('leanlander:insert-text', insertText)
    editor.onDidDispose(() => window.removeEventListener('leanlander:insert-text', insertText))

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
      defaultValue={file.content}
      defaultLanguage="lean4"
      height="100%"
      language="lean4"
      onChange={(content, event) => onChange(
        content ?? '',
        event.changes.map((change) => ({
          range: {
            start: {
              line: change.range.startLineNumber - 1,
              character: change.range.startColumn - 1,
            },
            end: {
              line: change.range.endLineNumber - 1,
              character: change.range.endColumn - 1,
            },
          },
          text: change.text,
        })),
      )}
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
        readOnly: file.readOnly,
      }}
      path={file.path}
      saveViewState
      theme={darkAppearance ? 'leanlander-dark' : 'leanlander'}
    />
  )
}