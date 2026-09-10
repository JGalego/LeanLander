import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { createTemporaryLeanProject, installFixture } from './fixtures.js'

test('opens and explores a temporary Lean project', async ({ page }) => {
  const project = await createTemporaryLeanProject('ProofGarden', [
    {
      path: 'ProofGarden/Main.lean',
      content: `import Mathlib

theorem garden_seed (n : Nat) : n + 0 = n := by
  simp
`,
      proofState: {
        declaration: 'garden_seed',
        goalCount: 1,
        hypotheses: [{ name: 'n', type: 'Nat' }],
        target: 'n + 0 = n',
      },
    },
    {
      path: 'ProofGarden/Topology.lean',
      content: `import Mathlib.Topology.Basic

theorem closed_univ (α : Type) [TopologicalSpace α] : IsClosed (Set.univ : Set α) := by
  exact isClosed_univ
`,
      proofState: {
        goals: [
          {
            declaration: 'case base',
            hypotheses: [{ name: 'α', type: 'Type' }],
            target: 'IsClosed (Set.univ : Set α)',
          },
          {
            declaration: 'case step.left',
            hypotheses: [{ name: 'n', type: 'Nat' }],
            target: 'n = n',
          },
          {
            declaration: 'case step.right',
            hypotheses: [],
            target: 'True',
          },
        ],
      },
    },
  ])
  project.fixture.diagnostics = {
    'ProofGarden/Topology.lean': [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 7 } },
        severity: 3,
        source: 'Lean',
        message: '#check IsClosed : Set α → Prop',
      },
      {
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
        severity: 3,
        source: 'Lean',
        message: '#eval result: 4',
      },
    ],
  }

  try {
    await installFixture(page, project.fixture)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-e2e-harness', 'ready')
    await page.getByRole('button', { name: 'Open project' }).click()

    await expect(page.getByText('Opened ProofGarden')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Main.lean' })).toBeVisible()
    await expect(page.locator('.monaco-editor')).toContainText('garden_seed')
    await expect(page.getByText('⊢ n + 0 = n', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Topology.lean' }).click()
    await expect(page.locator('.monaco-editor')).toContainText('closed_univ')
    await expect(page.getByText('IsClosed (Set.univ : Set α)')).toBeVisible()
    await expect(page.getByText('3 goals')).toBeVisible()
    await expect(page.getByText('case step.right')).toBeVisible()
    await expect(page.getByText('#eval result: 4')).toBeVisible()

    await page.keyboard.press('Control+Shift+F')
    const filter = page.getByRole('searchbox', { name: 'Filter project files' })
    await expect(filter).toBeFocused()
    await filter.fill('closed_univ')
    await expect(page.getByRole('button', { name: /Topology\.lean:3/ })).toBeVisible()

    const syncCount = await page.locator('html').getAttribute('data-sync-count')
    await page.getByRole('tab', { name: 'Main.lean' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-sync-count', syncCount ?? '2')

    await page.getByRole('button', { name: 'Build' }).click()
    await expect(page.getByText('Build completed')).toBeVisible()
  } finally {
    await project.dispose()
  }
})

test('expands Lean abbreviations and exposes platform accelerators', async ({ page }) => {
  const project = await createTemporaryLeanProject('UnicodeProof', [{
    path: 'Main.lean',
    content: 'example : True := by trivial\n',
  }])

  try {
    await installFixture(page, project.fixture)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-e2e-harness', 'ready')
    await page.getByRole('button', { name: 'Open project' }).click()
    await page.locator('.monaco-editor').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('\\forall \\epsilon > 0, \\exists \\delta > 0 ')
    await expect(page.locator('.monaco-editor')).toContainText('∀ ε > 0, ∃ δ > 0')

    await page.keyboard.type('\\<>')
    await page.keyboard.press('Tab')
    await expect(page.locator('.monaco-editor')).toContainText('⟨⟩')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.monaco-editor')).toContainText('\\<>')

    await page.keyboard.press('Control+s')
    await expect(page.getByText('Saved Main.lean')).toBeVisible()
    await page.keyboard.press('Control+p')
    await expect(page.getByRole('searchbox', { name: 'Filter project files' })).toBeFocused()
    await page.keyboard.press('Control+Shift+d')
    await expect(page.getByRole('dialog', { name: 'Lean Doctor' })).toBeVisible()
  } finally {
    await project.dispose()
  }
})

test('a newcomer proves two plus two without preinstalled Lean tools', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  const startedAt = Date.now()
  const project = await createTemporaryLeanProject('ArithmeticProof', [{
    path: 'Main.lean',
    content: '',
  }])
  project.fixture.toolchainStatus = {
    state: 'missing-toolchain',
    elanPath: '/mock/.elan/bin/elan',
    elanVersion: '4.2.0',
    requiredToolchain: 'leanprover/lean4:v4.19.0',
    activeToolchain: null,
    installedToolchains: [],
    repairs: [{
      id: 'install-toolchain',
      label: 'Install Lean toolchain',
      description: 'Install the project-required Lean toolchain.',
      command: ['elan', 'toolchain', 'install', 'leanprover/lean4:v4.19.0'],
      canRun: true,
    }],
  }

  try {
    await installFixture(page, project.fixture)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-e2e-harness', 'ready')

    await page.getByRole('button', { name: 'Install Lean toolchain' }).click()
    const newProject = page.getByRole('button', { name: 'New project' })
    await expect(newProject).toBeEnabled()
    await newProject.click()
    await page.getByLabel('Project name').fill('ArithmeticProof')
    await page.getByRole('button', { name: 'Create project' }).click()
    await expect(page.getByText('Opened ArithmeticProof')).toBeVisible()

    await page.locator('.monaco-editor').click()
    await page.keyboard.type('example : 2 + 2 = 4 := by decide', { delay: 10 })
    await expect(page.locator('.monaco-editor')).toContainText('example : 2 + 2 = 4 := by decide')
    await expect(page.getByText('No goals here')).toBeVisible()
    await page.keyboard.press('Control+s')
    await expect(page.getByText('Saved Main.lean')).toBeVisible()

    const elapsedMs = Date.now() - startedAt
    expect(elapsedMs).toBeLessThan(120_000)
    console.log(`LeanLander newcomer acceptance: ${elapsedMs} ms`)
    await testInfo.attach('newcomer-acceptance', {
      body: JSON.stringify({ elapsedMs, hostLeanRequired: false }, null, 2),
      contentType: 'application/json',
    })
  } finally {
    await project.dispose()
  }
})

test('keeps Doctor details explicit and keyboard accessible', async ({ page }) => {
  const project = await createTemporaryLeanProject('DoctorFixture', [{
    path: 'Main.lean',
    content: 'theorem healthy : True := by trivial\n',
  }])

  try {
    await installFixture(page, project.fixture)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-e2e-harness', 'ready')
    const doctorButton = page.getByRole('button', { name: 'Doctor' })
    await doctorButton.click()

    await expect(page.getByRole('dialog', { name: 'Lean Doctor' })).toBeVisible()
    await expect(page.getByText('E2E fixture environment')).toHaveCount(0)
    await page.getByRole('button', { name: 'Show details' }).click()
    await expect(page.getByText('E2E fixture environment')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(doctorButton).toBeFocused()
  } finally {
    await project.dispose()
  }
})

test('has no detectable serious accessibility violations', async ({ page }) => {
  const project = await createTemporaryLeanProject('AccessibleProof', [{
    path: 'Main.lean',
    content: 'theorem accessible : True := by trivial\n',
  }])

  try {
    await installFixture(page, project.fixture)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-e2e-harness', 'ready')
    await page.getByRole('button', { name: 'Open project' }).click()
    await expect(page.locator('.monaco-editor')).toContainText('accessible')

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  } finally {
    await project.dispose()
  }
})