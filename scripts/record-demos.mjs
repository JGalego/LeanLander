import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
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
const corpusId = process.argv.find((argument) => argument.startsWith('--corpus='))?.split('=', 2)[1]
const selectedCorpora = corpusId
  ? demoCorpora.filter((corpus) => corpus.id === corpusId)
  : demoCorpora

if (selectedCorpora.length === 0) {
  throw new Error(`Unknown demo corpus: ${corpusId}`)
}

async function fetchSources(corpus) {
  return Promise.all(corpus.files.map(async (file) => {
    let content = file.source
    if (content === undefined) {
      const response = await fetch(rawSourceUrl(corpus, file.path))
      if (response.ok === false) {
        throw new Error(`Unable to fetch ${file.path}: HTTP ${response.status}`)
      }
      content = await response.text()
    }

    const hash = createHash('sha256').update(content).digest('hex')
    if (file.sha256 !== undefined && hash !== file.sha256) {
      throw new Error(`Integrity check failed for ${file.path}: expected ${file.sha256}, received ${hash}`)
    }
    if (content.includes(file.focus) === false) {
      throw new Error(`Focus marker not found in ${file.path}: ${file.focus}`)
    }

    return { ...file, content, sha256: hash }
  }))
}

function goLeanInfoview(widgetSource) {
  const sgfMoves = [
    'pd', 'dp', 'cd', 'qp', 'op', 'oq', 'nq', 'pq', 'cn', 'fq', 'mp', 'qn',
    'ic', 'dj', 'po', 'qo', 'cp', 'cq', 'bq', 'co', 'bp', 'bo', 'do', 'bn',
    'dq', 'ep', 'dr', 'cm', 'jp', 'cg', 'ed', 'qf', 'qe', 'pf', 'nd', 'pi',
  ]
  const initialActions = sgfMoves.map((point) => ({
    c: point.charCodeAt(0) - 97,
    kind: 'play',
    r: point.charCodeAt(1) - 97,
    who: '',
  }))
  const config = {
    blackName: 'AlphaGo', cols: 19, firstToMove: '', handicap: 0, ko: 'positional',
    komi2: 15, passesToScore: 2, rows: 19, scoring: 'area',
    selfCaptureAllowed: false, setupBlack: [], setupWhite: [], whiteName: 'Lee Sedol',
  }
  const game = {
    actions: initialActions,
    config,
  }
  const makeBoard = (moves) => Array.from({ length: 19 }, (_, row) =>
    Array.from({ length: 19 }, (_, col) => {
      const moveIndex = moves.findIndex((move) => move.r === row && move.c === col)
      return {
        dead: false,
        hoshi: (row === 3 || row === 9 || row === 15) && (col === 3 || col === 9 || col === 15),
        lastMove: moveIndex === moves.length - 1,
        stone: moveIndex < 0 ? '' : moveIndex % 2 === 0 ? 'black' : 'white',
        territory: '',
      }
    }))
  const labels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T']
  const response = (boardActions, phase = 'playing', reviewMove = 0, gameActions = boardActions) => ({
    error: null,
    game: { config, actions: gameActions },
    view: {
      blackAccepted: false, blackCaptures: 0, blackName: 'AlphaGo', board: makeBoard(boardActions),
      colLabels: labels, cols: 19,
      consecPasses: 0, handicapLeft: 0, komi: '7.5', moveNum: boardActions.length,
      passesToScore: 2, phase, result: null, reviewMove,
      rowLabels: Array.from({ length: 19 }, (_, index) => String(19 - index)), rows: 19,
      rulesSummary: 'area scoring · positional superko · komi 7.5', scoreCard: null,
      sgf: '(;GM[1]FF[4]SZ[19]KM[7.5]RU[Chinese]PB[AlphaGo]PW[Lee Sedol])',
      toMove: boardActions.length % 2 === 0 ? 'black' : 'white', totalMoves: gameActions.length,
      whiteAccepted: false, whiteCaptures: 0, whiteName: 'Lee Sedol',
    },
    warning: null,
  })
  const move37 = [...initialActions, { c: 14, kind: 'play', r: 9, who: '' }]
  return {
    widgets: [{
      id: 'GoLean.GoBoardWidget',
      javascriptHash: '13941612456979887841',
      props: { game, warnings: [] },
    }],
    widgetSource,
    rpcResponses: {
      'GoLean.update': [
        response(initialActions),
        response([], 'review', 0, initialActions),
        response(initialActions),
        response(move37),
      ],
    },
  }
}

async function projectFixture(corpus, sources) {
  const shortCommit = corpus.commit.slice(0, 12)
  const projectPath = `/demo/${corpus.id}@${shortCommit}`
  const buildMessage = corpus.buildVerification
    ? `${corpus.buildVerification} This recording uses a deterministic browser fixture.`
    : `Pinned source verified at ${shortCommit}; full upstream build not run.`
  const proofStates = Object.fromEntries(sources.map((source) => [
    source.path,
    source.proofState,
  ]))

  let infoview
  if (corpus.widgetSourcePath) {
    const widgetProject = process.env.LEANLANDER_WIDGET_PROJECT
    if (!widgetProject) {
      throw new Error(`LEANLANDER_WIDGET_PROJECT is required to record ${corpus.id}.`)
    }
    infoview = goLeanInfoview(await readFile(join(widgetProject, corpus.widgetSourcePath), 'utf8'))
  }

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
      capabilities: ['diagnostics', 'proofState', ...(infoview ? ['widgets'] : [])],
    },
    proofStates,
    infoview,
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
          summary: corpus.files.some((file) => file.source !== undefined)
            ? `LeanLander-authored demo source; upstream pinned at ${shortCommit}`
            : `${sources.length} files verified at ${shortCommit}`,
          repair: null,
        },
        {
          id: 'build-scope',
          label: 'Recording scope',
          status: 'warning',
          summary: corpus.buildVerification
            ?? 'The full upstream Lake build is outside this deterministic recording.',
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
      message: buildMessage,
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
  if (declaration) {
    await page.locator('.proof-header strong')
      .getByText(declaration, { exact: true })
      .waitFor()
  } else {
    await page.getByText('No goals here', { exact: true }).waitFor()
  }
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
    }, await projectFixture(corpus, sources))

    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.locator('html[data-e2e-harness="ready"]').waitFor()
    await pause(page, 650)

    await page.getByRole('button', { name: 'Open project' }).click()
    await page.getByText(`Opened ${corpus.projectName}`, { exact: true }).waitFor()
    await page.locator('.monaco-editor').waitFor()

    if (corpus.widgetSourcePath) {
      const lineNumber = sources[0].content.slice(0, sources[0].content.indexOf(sources[0].focus))
        .split('\n').length
      await page.evaluate((line) => {
        window.dispatchEvent(new CustomEvent('leanlander:e2e-reveal-line', {
          detail: { lineNumber: line },
        }))
      }, lineNumber)
      const infoview = page.frameLocator('iframe[title="Lean infoview"]')
      const board = infoview.locator('svg')
      await board.waitFor()
      await infoview.getByText('Tactic state', { exact: true }).click()
      await pause(page, 1_500)
      await infoview.getByRole('button', { name: 'Back to game' }).click()
      await pause(page, 1_800)
      const box = await board.boundingBox()
      if (!box) throw new Error('Go board has no visible bounds.')
      const play = async (row, col) => {
        const padding = 30 / 492
        const spacing = 24 / 492
        await page.mouse.click(
          box.x + box.width * (padding + col * spacing),
          box.y + box.height * (padding + row * spacing),
        )
        await pause(page, 1_300)
      }
      await play(9, 14)
      await pause(page, 4_000)
    } else {
      await focusMarker(page, sources[0])
    }

    if (sources[1]) {
      await page.getByRole('button', { name: basename(sources[1].path) }).click()
      await focusMarker(page, sources[1])
    }

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
    const buildMessage = corpus.buildVerification
      ? `${corpus.buildVerification} This recording uses a deterministic browser fixture.`
      : `Pinned source verified at ${corpus.commit.slice(0, 12)}; full upstream build not run.`
    await page.getByText(buildMessage, { exact: true }).waitFor()
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
for (const corpus of selectedCorpora) {
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

    for (const corpus of selectedCorpora) {
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