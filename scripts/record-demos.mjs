import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { demoCorpora, rawSourceUrl } from './demo-corpora.mjs'

const viewport = { width: 1280, height: 720 }
const outputDirectory = fileURLToPath(new URL('../docs/assets/demos/', import.meta.url))
const verifyOnly = process.argv.includes('--verify-only')

async function fetchSources(corpus) {
  return Promise.all(corpus.files.map(async (file) => {
    const response = await fetch(rawSourceUrl(corpus, file.path))
    if (response.ok === false) {
      throw new Error(`Unable to fetch ${file.path}: HTTP ${response.status}`)
    }

    const content = await response.text()
    const hash = createHash('sha256').update(content).digest('hex')
    if (hash !== file.sha256) {
      throw new Error(`Integrity check failed for ${file.path}: expected ${file.sha256}, received ${hash}`)
    }
    if (content.includes(file.focus) === false) {
      throw new Error(`Focus marker not found in ${file.path}: ${file.focus}`)
    }

    return { ...file, content }
  }))
}

function projectFixture(corpus, sources) {
  const shortCommit = corpus.commit.slice(0, 12)
  const projectPath = `/demo/${corpus.id}@${shortCommit}`
  const proofStates = Object.fromEntries(sources.map((source) => [
    source.path,
    source.proofState,
  ]))

  return {
    project: {
      metadata: {
        name: corpus.projectName,
        path: projectPath,
        leanToolchain: corpus.toolchain,
        lakefile: corpus.lakefile,
        sourceRoots: [...new Set(sources.map((source) => source.path.split('/')[0]))],
        warnings: [],
      },
      files: sources.map((source) => ({
        id: source.path,
        name: basename(source.path),
        path: source.path,
        content: source.content,
      })),
    },
    toolchainStatus: {
      state: 'ready',
      elanPath: '/demo/.elan/bin/elan',
      elanVersion: '4.2.0',
      requiredToolchain: corpus.toolchain,
      activeToolchain: corpus.toolchain,
      installedToolchains: [{ name: corpus.toolchain, installed: true, active: true }],
      repairs: [],
    },
    serverStatus: {
      state: 'ready',
      message: 'Pinned proof-state fixture ready',
      toolchain: corpus.toolchain,
      version: corpus.toolchain.split(':v').at(-1) ?? null,
      capabilities: ['diagnostics', 'proofState'],
    },
    proofStates,
    doctorReport: {
      status: 'warning',
      checks: [
        {
          id: 'toolchain',
          label: 'Toolchain',
          status: 'ok',
          summary: `Pinned by upstream: ${corpus.toolchain}`,
          repair: null,
        },
        {
          id: 'snapshot',
          label: 'Source snapshot',
          status: 'ok',
          summary: `${sources.length} files verified at ${shortCommit}`,
          repair: null,
        },
        {
          id: 'build-scope',
          label: 'Recording scope',
          status: 'warning',
          summary: 'The full upstream Lake build is outside this deterministic recording.',
          repair: null,
        },
      ],
    },
    doctorLogs: {
      sections: [
        {
          label: 'Pinned upstream source',
          content: [
            corpus.repository,
            `commit ${corpus.commit}`,
            `toolchain ${corpus.toolchain}`,
            `license ${corpus.license}`,
            ...sources.map((source) => `${source.sha256}  ${source.path}`),
          ].join('\n'),
        },
        {
          label: 'Reproduce the full build',
          content: `git clone ${corpus.repository}.git\ncd ${corpus.repository.split('/').at(-1)}\ngit checkout ${corpus.commit}\nlake build`,
        },
      ],
    },
    lakeBuildProgress: {
      operation: 'build',
      stage: 'snapshot-only',
      message: `Pinned source verified at ${shortCommit}; full upstream build not run.`,
      running: false,
      succeeded: null,
      projectPath,
      failure: null,
    },
  }
}

async function pause(page, milliseconds = 1_200) {
  await page.waitForTimeout(milliseconds)
}

async function focusMarker(page, source) {
  const lineNumber = source.content.slice(0, source.content.indexOf(source.focus))
    .split('\n').length
  const declaration = source.proofState.goals?.[0]?.declaration
    ?? source.proofState.declaration
  await page.evaluate((line) => {
    window.dispatchEvent(new CustomEvent('leanlander:e2e-reveal-line', {
      detail: { lineNumber: line },
    }))
  }, lineNumber)
  await page.locator('.view-line').filter({ hasText: source.focus }).first().waitFor()
  await page.locator('.proof-header strong')
    .getByText(declaration, { exact: true })
    .waitFor()
  await pause(page, 1_500)
}

async function recordCorpus(browser, baseUrl, temporaryDirectory, corpus, sources) {
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: temporaryDirectory, size: viewport },
    reducedMotion: 'reduce',
  })
  let page
  let video

  try {
    page = await context.newPage()
    video = page.video()
    await page.addInitScript((fixture) => {
      localStorage.setItem('leanlander:e2e-fixture', JSON.stringify(fixture))
    }, projectFixture(corpus, sources))

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.locator('html[data-e2e-harness="ready"]').waitFor()
    await pause(page, 650)

    await page.getByRole('button', { name: 'Open project' }).click()
    await page.getByText(`Opened ${corpus.projectName}`, { exact: true }).waitFor()
    await page.locator('.monaco-editor').waitFor()
    await focusMarker(page, sources[0])

    await page.getByRole('button', { name: basename(sources[1].path) }).click()
    await focusMarker(page, sources[1])

    await page.getByRole('button', { name: 'Doctor' }).click()
    await page.getByRole('dialog', { name: 'Lean Doctor' }).waitFor()
    await pause(page)
    await page.getByRole('button', { name: 'Show details' }).click()
    await page.locator('.doctor-log-view pre')
      .filter({ hasText: `commit ${corpus.commit}` })
      .waitFor()
    await pause(page, 1_700)
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: 'Lean Doctor' }).waitFor({ state: 'hidden' })
    await pause(page, 700)

    const buildButton = page.getByRole('button', { name: 'Build' })
    if (await buildButton.isEnabled() === false) {
      throw new Error(`Source navigation modified ${corpus.id}; refusing to record a dirty fixture.`)
    }
    await buildButton.click()
    await page.getByText(`Pinned source verified at ${corpus.commit.slice(0, 12)}; full upstream build not run.`, { exact: true }).waitFor()
    await pause(page, 1_800)
  } finally {
    try {
      await page?.close()
    } finally {
      await context.close()
    }
  }

  if (!video) {
    throw new Error(`Video capture did not start for ${corpus.id}.`)
  }
  const webmPath = join(temporaryDirectory, `${corpus.id}.webm`)
  await video.saveAs(webmPath)
  return webmPath
}

function convertToGif(webmPath, gifPath) {
  const filter = [
    'fps=8',
    'scale=960:-1:flags=lanczos',
    'split[stream1][stream2]',
    '[stream1]palettegen=max_colors=128:stats_mode=diff[palette]',
    '[stream2][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
  ].join(',')
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-ss', '3',
    '-i', webmPath,
    '-filter_complex', filter,
    '-loop', '0',
    gifPath,
  ], { encoding: 'utf8' })

  if (result.error) {
    throw new Error(`Unable to run ffmpeg: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${webmPath}: ${result.stderr}`)
  }
}

const sourceSets = new Map()
for (const corpus of demoCorpora) {
  const sources = await fetchSources(corpus)
  sourceSets.set(corpus.id, sources)
  console.log(`Verified ${corpus.id} at ${corpus.commit}`)
}

if (verifyOnly === false) {
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  if (ffmpeg.status !== 0) {
    throw new Error('ffmpeg is required to generate GIF recordings.')
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'leanlander-demos-'))
  let server
  let browser

  try {
    await mkdir(outputDirectory, { recursive: true })
    server = await createServer({
      mode: 'e2e',
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    })
    await server.listen()
    const baseUrl = server.resolvedUrls?.local.at(0)
    if (!baseUrl) {
      throw new Error('Vite did not expose a local recording URL.')
    }
    browser = await chromium.launch()

    for (const corpus of demoCorpora) {
      const sources = sourceSets.get(corpus.id)
      const webmPath = await recordCorpus(browser, baseUrl, temporaryDirectory, corpus, sources)
      const gifPath = join(outputDirectory, `${corpus.id}.gif`)
      convertToGif(webmPath, gifPath)
      console.log(`Recorded ${gifPath}`)
    }
  } finally {
    await browser?.close()
    await server?.close()
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}