import type { Monaco } from '@monaco-editor/react'
import type { languages } from 'monaco-editor'
import type {
  LanguageClient,
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspMarkupContent,
  LspPosition,
  LspRange,
} from '../services/languageClient'

export interface LeanLanguageContext {
  client: LanguageClient
  projectPath: string
  relativePath: string
}

interface Disposable {
  dispose(): void
}

export function registerLeanLanguageProviders(
  monaco: Monaco,
  getContext: () => LeanLanguageContext | null,
): Disposable {
  const providers = [
    monaco.languages.registerHoverProvider('lean4', {
      async provideHover(_model, position) {
        const context = getContext()
        if (!context) {
          return null
        }
        const hover = await requestOrNull<LspHover>(context, 'hover', position)
        if (!hover) {
          return null
        }
        return {
          contents: hoverContents(hover.contents),
          range: hover.range ? toMonacoRange(monaco, hover.range) : undefined,
        }
      },
    }),
    monaco.languages.registerCompletionItemProvider('lean4', {
      triggerCharacters: ['.', '@'],
      async provideCompletionItems(model, position) {
        const context = getContext()
        if (!context) {
          return { suggestions: [] }
        }
        const response = await requestOrNull<LspCompletionItem[] | LspCompletionList>(
          context,
          'completion',
          position,
        )
        const items = Array.isArray(response) ? response : response?.items ?? []
        const word = model.getWordUntilPosition(position)
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        )
        return {
          incomplete: !Array.isArray(response) && Boolean(response?.isIncomplete),
          suggestions: items.map((item) => ({
            label: item.label,
            kind: completionKind(monaco, item.kind),
            detail: item.detail,
            documentation: documentation(item.documentation),
            insertText: item.insertText ?? completionLabel(item),
            sortText: item.sortText,
            filterText: item.filterText,
            range,
          })),
        }
      },
    }),
    monaco.languages.registerDefinitionProvider('lean4', {
      async provideDefinition(_model, position) {
        const context = getContext()
        if (!context) {
          return null
        }
        const response = await requestOrNull<
          LspLocation | LspLocation[] | LspLocationLink[]
        >(context, 'definition', position)
        return locations(monaco, response)
      },
    }),
    monaco.languages.registerReferenceProvider('lean4', {
      async provideReferences(_model, position) {
        const context = getContext()
        if (!context) {
          return null
        }
        const response = await requestOrNull<LspLocation[]>(context, 'references', position)
        return locations(monaco, response)
      },
    }),
    monaco.languages.registerDocumentSymbolProvider('lean4', {
      async provideDocumentSymbols() {
        const context = getContext()
        if (!context) {
          return []
        }
        const response = await context.client.request<LspDocumentSymbol[]>(
          context.projectPath,
          context.relativePath,
          'documentSymbols',
          { line: 0, character: 0 },
        ).catch(() => null)
        return response?.map((symbol) => documentSymbol(monaco, symbol)) ?? []
      },
    }),
  ]

  return {
    dispose() {
      providers.forEach((provider) => provider.dispose())
    },
  }
}

export function applyLeanDiagnostics(
  monaco: Monaco,
  model: Parameters<Monaco['editor']['setModelMarkers']>[0],
  diagnostics: LspDiagnostic[],
) {
  monaco.editor.setModelMarkers(
    model,
    'lean',
    diagnostics.map((diagnostic) => ({
      ...rangeCoordinates(diagnostic.range),
      severity: diagnosticSeverity(monaco, diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source ?? 'Lean',
      code: diagnostic.code?.toString(),
    })),
  )
}

function requestOrNull<T>(
  context: LeanLanguageContext,
  feature: 'hover' | 'completion' | 'definition' | 'references',
  position: { lineNumber: number; column: number },
) {
  return context.client.request<T>(
    context.projectPath,
    context.relativePath,
    feature,
    toLspPosition(position),
  ).catch(() => null)
}

export function toLspPosition(position: { lineNumber: number; column: number }): LspPosition {
  return {
    line: Math.max(0, position.lineNumber - 1),
    character: Math.max(0, position.column - 1),
  }
}

function toMonacoRange(monaco: Monaco, range: LspRange) {
  return new monaco.Range(
    range.start.line + 1,
    range.start.character + 1,
    range.end.line + 1,
    range.end.character + 1,
  )
}

function rangeCoordinates(range: LspRange) {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

function diagnosticSeverity(monaco: Monaco, severity?: number) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error
    case 2:
      return monaco.MarkerSeverity.Warning
    case 4:
      return monaco.MarkerSeverity.Hint
    default:
      return monaco.MarkerSeverity.Info
  }
}

function hoverContents(contents: LspHover['contents']) {
  const values = Array.isArray(contents) ? contents : [contents]
  return values.map((value) => ({
    value: typeof value === 'string' ? value : value.value,
    isTrusted: false,
    supportHtml: false,
  }))
}

function documentation(value?: LspMarkupContent | string) {
  if (!value) {
    return undefined
  }
  return { value: typeof value === 'string' ? value : value.value }
}

function completionLabel(item: LspCompletionItem) {
  return typeof item.label === 'string' ? item.label : item.label.label
}

function completionKind(monaco: Monaco, kind?: number) {
  const kinds = [
    monaco.languages.CompletionItemKind.Text,
    monaco.languages.CompletionItemKind.Method,
    monaco.languages.CompletionItemKind.Function,
    monaco.languages.CompletionItemKind.Constructor,
    monaco.languages.CompletionItemKind.Field,
    monaco.languages.CompletionItemKind.Variable,
    monaco.languages.CompletionItemKind.Class,
    monaco.languages.CompletionItemKind.Interface,
    monaco.languages.CompletionItemKind.Module,
    monaco.languages.CompletionItemKind.Property,
    monaco.languages.CompletionItemKind.Unit,
    monaco.languages.CompletionItemKind.Value,
    monaco.languages.CompletionItemKind.Enum,
    monaco.languages.CompletionItemKind.Keyword,
    monaco.languages.CompletionItemKind.Snippet,
    monaco.languages.CompletionItemKind.Color,
    monaco.languages.CompletionItemKind.File,
    monaco.languages.CompletionItemKind.Reference,
    monaco.languages.CompletionItemKind.Folder,
    monaco.languages.CompletionItemKind.EnumMember,
    monaco.languages.CompletionItemKind.Constant,
    monaco.languages.CompletionItemKind.Struct,
    monaco.languages.CompletionItemKind.Event,
    monaco.languages.CompletionItemKind.Operator,
    monaco.languages.CompletionItemKind.TypeParameter,
  ]
  return kinds[(kind ?? 1) - 1] ?? monaco.languages.CompletionItemKind.Text
}

function locations(
  monaco: Monaco,
  response: LspLocation | LspLocation[] | LspLocationLink[] | null,
) {
  if (!response) {
    return null
  }
  const values = Array.isArray(response) ? response : [response]
  return values.map((location) => {
    if ('targetUri' in location) {
      return {
        uri: monaco.Uri.parse(location.targetUri),
        range: toMonacoRange(monaco, location.targetSelectionRange),
      }
    }
    return {
      uri: monaco.Uri.parse(location.uri),
      range: toMonacoRange(monaco, location.range),
    }
  })
}

function documentSymbol(monaco: Monaco, symbol: LspDocumentSymbol): languages.DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail ?? '',
    kind: symbolKind(monaco, symbol.kind),
    tags: [],
    range: toMonacoRange(monaco, symbol.range),
    selectionRange: toMonacoRange(monaco, symbol.selectionRange),
    children: symbol.children?.map((child) => documentSymbol(monaco, child)),
  }
}

function symbolKind(monaco: Monaco, kind: number) {
  const kinds = [
    monaco.languages.SymbolKind.File,
    monaco.languages.SymbolKind.Module,
    monaco.languages.SymbolKind.Namespace,
    monaco.languages.SymbolKind.Package,
    monaco.languages.SymbolKind.Class,
    monaco.languages.SymbolKind.Method,
    monaco.languages.SymbolKind.Property,
    monaco.languages.SymbolKind.Field,
    monaco.languages.SymbolKind.Constructor,
    monaco.languages.SymbolKind.Enum,
    monaco.languages.SymbolKind.Interface,
    monaco.languages.SymbolKind.Function,
    monaco.languages.SymbolKind.Variable,
    monaco.languages.SymbolKind.Constant,
    monaco.languages.SymbolKind.String,
    monaco.languages.SymbolKind.Number,
    monaco.languages.SymbolKind.Boolean,
    monaco.languages.SymbolKind.Array,
    monaco.languages.SymbolKind.Object,
    monaco.languages.SymbolKind.Key,
    monaco.languages.SymbolKind.Null,
    monaco.languages.SymbolKind.EnumMember,
    monaco.languages.SymbolKind.Struct,
    monaco.languages.SymbolKind.Event,
    monaco.languages.SymbolKind.Operator,
    monaco.languages.SymbolKind.TypeParameter,
  ]
  return kinds[kind - 1] ?? monaco.languages.SymbolKind.Variable
}