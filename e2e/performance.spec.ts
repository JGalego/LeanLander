import { expect, test, type CDPSession } from '@playwright/test'
import { createTemporaryLeanProject, installFixture } from './fixtures.js'

const performanceBudget = {
  reactCommitMs: 2_000,
  editorReadyMs: 8_000,
  initialHeapBytes: 180 * 1024 * 1024,
  largeFileHeapGrowthBytes: 96 * 1024 * 1024,
}

test('profiles startup and large-file editor memory', async ({ context, page }, testInfo) => {
  const declarations = Array.from(
    { length: 18_000 },
    (_, index) => `theorem proof_${index.toString().padStart(5, '0')} (n : Nat) : n + 0 = n := by simp`,
  )
  const content = `namespace PerformanceProof\n\n${declarations.join('\n')}\n\nend PerformanceProof\n`
  const project = await createTemporaryLeanProject('PerformanceProof', [{
    path: 'PerformanceProof/Main.lean',
    content,
  }])
  const session = await context.newCDPSession(page)

  try {
    await session.send('Performance.enable')
    project.fixture.project.files.push(...Array.from({ length: 5_000 }, (_, index) => ({
      id: `Mathlib/Analysis/Generated${index}.lean`,
      name: `Generated${index}.lean`,
      path: `Mathlib/Analysis/Generated${index}.lean`,
      content: '',
      loaded: false,
    })))
    await installFixture(page, project.fixture)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-e2e-harness', 'ready')
    await expect.poll(() => page.evaluate(() => (
      performance.getEntriesByName('leanlander:editor-ready').length
    ))).toBe(1)

    const startup = await page.evaluate(() => {
      const mark = (name: string) => performance.getEntriesByName(name).at(0)?.startTime
      const bootstrap = mark('leanlander:bootstrap')
      const appReady = mark('leanlander:app-ready')
      const editorReady = mark('leanlander:editor-ready')
      if (bootstrap === undefined || appReady === undefined || editorReady === undefined) {
        throw new Error('LeanLander performance marks are incomplete.')
      }
      return {
        reactCommitMs: appReady - bootstrap,
        editorReadyMs: editorReady - bootstrap,
      }
    })
    const initialHeapBytes = await collectHeap(session)

    await page.getByRole('button', { name: 'Open project' }).click()
    await expect(page.getByText('Opened PerformanceProof')).toBeVisible()
    await expect(page.locator('.monaco-editor')).toContainText('proof_00000')
    const largeFileHeapBytes = await collectHeap(session)

    const profile = {
      ...startup,
      initialHeapBytes,
      largeFileBytes: Buffer.byteLength(content),
      largeFileHeapBytes,
      largeFileHeapGrowthBytes: Math.max(0, largeFileHeapBytes - initialHeapBytes),
      browser: testInfo.project.name,
    }
    await testInfo.attach('performance-profile', {
      body: JSON.stringify(profile, null, 2),
      contentType: 'application/json',
    })
    console.log(`LeanLander performance profile: ${JSON.stringify(profile)}`)

    expect(profile.reactCommitMs).toBeLessThan(performanceBudget.reactCommitMs)
    expect(profile.editorReadyMs).toBeLessThan(performanceBudget.editorReadyMs)
    expect(profile.initialHeapBytes).toBeLessThan(performanceBudget.initialHeapBytes)
    expect(profile.largeFileHeapGrowthBytes)
      .toBeLessThan(performanceBudget.largeFileHeapGrowthBytes)
  } finally {
    await session.detach()
    await project.dispose()
  }
})

async function collectHeap(session: CDPSession): Promise<number> {
  await session.send('HeapProfiler.collectGarbage')
  const { metrics } = await session.send('Performance.getMetrics')
  return metrics.find((metric) => metric.name === 'JSHeapUsedSize')?.value ?? 0
}