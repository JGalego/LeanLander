export const performanceMarks = {
  bootstrap: 'leanlander:bootstrap',
  appReady: 'leanlander:app-ready',
  editorReady: 'leanlander:editor-ready',
} as const

export function markOnce(name: string) {
  if (typeof performance !== 'undefined' && performance.getEntriesByName(name).length === 0) {
    performance.mark(name)
  }
}