import type { Monaco } from '@monaco-editor/react'

const leanKeywords = [
  'abbrev',
  'axiom',
  'by',
  'class',
  'def',
  'deriving',
  'do',
  'else',
  'end',
  'example',
  'export',
  'extends',
  'for',
  'if',
  'import',
  'in',
  'inductive',
  'instance',
  'let',
  'match',
  'namespace',
  'open',
  'opaque',
  'partial',
  'private',
  'protected',
  'structure',
  'syntax',
  'then',
  'theorem',
  'universe',
  'variable',
  'where',
  'with',
]

const tacticKeywords = [
  'apply',
  'assumption',
  'cases',
  'constructor',
  'exact',
  'induction',
  'intro',
  'linarith',
  'omega',
  'positivity',
  'rfl',
  'simp',
  'simpa',
  'rw',
]

let configured = false

export function configureLeanLanguage(monaco: Monaco) {
  if (configured) {
    return
  }

  monaco.languages.register({ id: 'lean4', extensions: ['.lean'], aliases: ['Lean 4'] })
  monaco.languages.setLanguageConfiguration('lean4', {
    comments: { lineComment: '--', blockComment: ['/-', '-/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  })
  monaco.languages.setMonarchTokensProvider('lean4', {
    keywords: leanKeywords,
    tactics: tacticKeywords,
    tokenizer: {
      root: [
        [/\/-!/, 'comment.doc', '@comment'],
        [/\/-/, 'comment', '@comment'],
        [/--.*$/, 'comment'],
        [/"/, 'string', '@string'],
        [/[0-9]+(?:\.[0-9]+)?/, 'number'],
        [/[A-Za-z_α-ωΑ-Ω][\w'α-ωΑ-Ω]*/, {
          cases: {
            '@keywords': 'keyword',
            '@tactics': 'keyword.tactic',
            '@default': 'identifier',
          },
        }],
        [/[=><:+\-*/^|&~!?%≤≥≠→←↔∀∃⊢]+/, 'operator'],
      ],
      comment: [
        [/[^/-]+/, 'comment'],
        [/\/-/, 'comment', '@push'],
        [/-\//, 'comment', '@pop'],
        [/[/-]/, 'comment'],
      ],
      string: [
        [/[^\\"]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],
    },
  })
  monaco.editor.defineTheme('leanlander', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '778078', fontStyle: 'italic' },
      { token: 'comment.doc', foreground: '647568', fontStyle: 'italic' },
      { token: 'identifier', foreground: '26322C' },
      { token: 'keyword', foreground: '8B3A2E', fontStyle: 'bold' },
      { token: 'keyword.tactic', foreground: '086B5A', fontStyle: 'bold' },
      { token: 'number', foreground: '9A5B13' },
      { token: 'operator', foreground: '3A6258' },
      { token: 'string', foreground: '8A4B20' },
    ],
    colors: {
      'editor.background': '#FBFCF8',
      'editor.foreground': '#26322C',
      'editor.lineHighlightBackground': '#F0F3EC',
      'editorLineNumber.foreground': '#A0A89F',
      'editorLineNumber.activeForeground': '#52615A',
      'editor.selectionBackground': '#CFE6DD',
      'editor.inactiveSelectionBackground': '#E0ECE6',
      'editorCursor.foreground': '#08715E',
      'editorIndentGuide.background1': '#E5E9E2',
      'editorWhitespace.foreground': '#DCE1DA',
    },
  })

  configured = true
}