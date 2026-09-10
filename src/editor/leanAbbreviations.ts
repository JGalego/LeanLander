import { AbbreviationProvider } from '@leanprover/unicode-input'

const provider = new AbbreviationProvider({
  abbreviationCharacter: '\\',
  customTranslations: {},
  eagerReplacementEnabled: true,
})

export const leanAbbreviations: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(provider.getSymbolsByAbbreviation())
    .map(([abbreviation, symbol]) => [`\\${abbreviation}`, symbol]),
)

export interface LeanAbbreviationMatch {
  abbreviation: string
  replacement: string
  startColumn: number
  endColumn: number
  cursorOffset?: number
}

export function findLeanAbbreviation(
  linePrefix: string,
  triggerLength = 0,
): LeanAbbreviationMatch | null {
  const contentEnd = linePrefix.length - triggerLength
  if (contentEnd < 1) return null

  const slash = linePrefix.lastIndexOf('\\', contentEnd - 1)
  if (slash < 0) return null

  const abbreviation = linePrefix.slice(slash + 1, contentEnd)
  const rawReplacement = provider.getReplacementText(abbreviation)
  if (!rawReplacement || rawReplacement === abbreviation) return null
  const cursorMarker = rawReplacement.indexOf('$CURSOR')
  const replacement = rawReplacement.replace('$CURSOR', '')

  return {
    abbreviation: `\\${abbreviation}`,
    replacement,
    startColumn: slash + 1,
    endColumn: contentEnd + 1,
    cursorOffset: cursorMarker >= 0 ? cursorMarker : undefined,
  }
}