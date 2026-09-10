import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './index.css'
import App from './App.tsx'
import { markOnce, performanceMarks } from './performance.ts'

markOnce(performanceMarks.bootstrap)

if (import.meta.env.MODE === 'e2e') {
  const { installE2eHarness } = await import('./e2eHarness.ts')
  installE2eHarness()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
