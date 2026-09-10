import { useEffect, useRef } from 'react'
import type { InfoviewApi, InfoviewConfig } from '@leanprover/infoview'
import type { ShowDocumentParams, TextDocumentPositionParams } from 'vscode-languageserver-protocol'
import type { LanguageClient } from '../services/languageClient'
import frameSource from '../infoviewFrame.js?raw'
import loaderSource from '../../node_modules/@leanprover/infoview/dist/loader.production.min.js?raw'
import infoviewSource from '../../node_modules/@leanprover/infoview/dist/index.production.min.js?raw'
import reactSource from '../../node_modules/@leanprover/infoview/dist/react.production.min.js?raw'
import jsxRuntimeSource from '../../node_modules/@leanprover/infoview/dist/react-jsx-runtime.production.min.js?raw'
import reactDomSource from '../../node_modules/@leanprover/infoview/dist/react-dom.production.min.js?raw'
import infoviewCss from '../../node_modules/@leanprover/infoview/dist/index.css?raw'

interface InfoviewPanelProps {
  column: number
  language: LanguageClient
  lineNumber: number
  onOpenLocation: (uri: string, range: { start: { line: number; character: number } }) => Promise<void>
  projectPath: string
  relativePath: string
  rpcWireFormat?: 'v0' | 'v1' | null
  serverVersion: string | null
  processing: boolean
}

interface FrameMessage {
  source?: string
  type?: 'ready' | 'request'
  id?: number
  method?: string
  args?: unknown[]
}

const defaultConfig: InfoviewConfig = {
  allErrorsOnLine: false,
  autoOpenShowsGoal: true,
  debounceTime: 50,
  expectedTypeVisibility: 'Collapsed by default',
  showGoalNames: true,
  emphasizeFirstGoal: false,
  reverseTacticState: false,
  hideTypeAssumptions: false,
  hideInstanceAssumptions: false,
  hideInaccessibleAssumptions: false,
  hideLetValues: false,
  showTooltipOnHover: true,
  messageOrder: 'Sort by proximity to text cursor',
}

function documentUri(projectPath: string, relativePath: string) {
  const path = `${projectPath}/${relativePath}`.replaceAll('\\', '/')
  const encoded = path.split('/').map((part) => encodeURIComponent(part)).join('/')
  return path.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
}

function location(uri: string, lineNumber: number, column: number) {
  const position = {
    line: Math.max(0, lineNumber - 1),
    character: Math.max(0, column - 1),
  }
  return { uri, range: { start: position, end: position } }
}

function storedConfig() {
  const saved = localStorage.getItem('leanlander:infoview-config')
  if (!saved) return defaultConfig
  try {
    return { ...defaultConfig, ...JSON.parse(saved) } as InfoviewConfig
  } catch {
    return defaultConfig
  }
}

export function InfoviewPanel(props: InfoviewPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const readyRef = useRef(false)
  const stateRef = useRef(props)

  useEffect(() => {
    stateRef.current = props
  }, [props])

  const sendEvent = (method: keyof InfoviewApi, ...args: unknown[]) => {
    iframeRef.current?.contentWindow?.postMessage({
      source: 'leanlander-host',
      type: 'event',
      method,
      args,
    }, '*')
  }

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const respond = (id: number, result?: unknown, error?: unknown) => {
      iframe.contentWindow?.postMessage({
        source: 'leanlander-host',
        type: 'response',
        id,
        result,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      }, '*')
    }

    const handleRequest = async (method: string, args: unknown[]) => {
      const state = stateRef.current
      switch (method) {
        case 'saveConfig':
          localStorage.setItem('leanlander:infoview-config', JSON.stringify(args[0]))
          return
        case 'sendClientRequest':
          if (!state.language.infoviewRequest) throw new Error('The Lean infoview RPC bridge is unavailable.')
          return state.language.infoviewRequest(
            state.projectPath,
            state.relativePath,
            String(args[1]),
            args[2],
          )
        case 'sendClientNotification':
          return state.language.infoviewNotification?.(
            state.projectPath,
            state.relativePath,
            String(args[1]),
            args[2],
          )
        case 'subscribeServerNotifications':
        case 'unsubscribeServerNotifications':
        case 'subscribeClientNotifications':
        case 'unsubscribeClientNotifications':
        case 'restartFile':
          return
        case 'copyToClipboard':
          return navigator.clipboard.writeText(String(args[0]))
        case 'insertText': {
          const position = (args[2] as TextDocumentPositionParams | undefined)?.position
          window.dispatchEvent(new CustomEvent('leanlander:insert-text', {
            detail: { text: String(args[0]), kind: args[1], position },
          }))
          return
        }
        case 'applyEdit':
          throw new Error('Workspace edits from the infoview are not supported yet.')
        case 'showDocument': {
          const show = args[0] as ShowDocumentParams
          const selection = show.selection ?? {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          }
          return state.onOpenLocation(show.uri, selection)
        }
        case 'createRpcSession':
          if (!state.language.createRpcSession) throw new Error('Lean RPC sessions are unavailable.')
          return state.language.createRpcSession(state.projectPath, state.relativePath)
        case 'closeRpcSession':
          return state.language.closeRpcSession?.(state.projectPath, String(args[0]))
        default:
          throw new Error(`Unsupported infoview editor method: ${method}`)
      }
    }

    const receiveMessage = (event: MessageEvent<FrameMessage>) => {
      const message = event.data
      if (event.source !== iframe.contentWindow || message?.source !== 'leanlander-infoview') return
      if (message.type === 'request' && typeof message.id === 'number' && message.method) {
        void handleRequest(message.method, message.args ?? []).then(
          (result) => respond(message.id!, result),
          (error) => respond(message.id!, undefined, error),
        )
      } else if (message.type === 'ready') {
        readyRef.current = true
        const state = stateRef.current
        const uri = documentUri(state.projectPath, state.relativePath)
        sendEvent('initialize', location(uri, state.lineNumber, state.column))
        sendEvent('serverRestarted', {
          capabilities: {
            experimental: {
              rpcProvider: { rpcWireFormat: state.rpcWireFormat ?? 'v0' },
            },
          },
          serverInfo: { name: 'Lean', version: state.serverVersion ?? undefined },
        })
        sendEvent('changedInfoviewConfig', storedConfig())
      }
    }

    window.addEventListener('message', receiveMessage)
    const initializeFrame = () => {
      iframe.contentWindow?.postMessage({
        source: 'leanlander-host',
        type: 'initialize',
        modules: {
          loader: loaderSource,
          infoview: infoviewSource,
          react: reactSource,
          jsxRuntime: jsxRuntimeSource,
          reactDom: reactDomSource,
          css: infoviewCss,
        },
      }, '*')
    }
    iframe.addEventListener('load', initializeFrame, { once: true })
    const frameDocument = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; connect-src blob:; style-src 'unsafe-inline' blob:; img-src data: blob:"></head><body><main id="root"></main><script>${frameSource}</script></body></html>`
    iframe.src = `data:text/html;charset=utf-8,${encodeURIComponent(frameDocument)}`

    return () => {
      readyRef.current = false
      window.removeEventListener('message', receiveMessage)
      iframe.removeEventListener('load', initializeFrame)
    }
  }, [])

  useEffect(() => {
    if (!readyRef.current) return
    const uri = documentUri(props.projectPath, props.relativePath)
    sendEvent('changedCursorLocation', location(uri, props.lineNumber, props.column))
  }, [props.column, props.lineNumber, props.processing, props.projectPath, props.relativePath])

  return (
    <aside aria-label="Lean infoview" className="proof-panel infoview-panel">
      <iframe ref={iframeRef} sandbox="allow-scripts" title="Lean infoview" />
    </aside>
  )
}