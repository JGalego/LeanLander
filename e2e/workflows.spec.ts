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
        declaration: 'closed_univ',
        goalCount: 1,
        hypotheses: [
          { name: 'α', type: 'Type' },
          { name: 'inst', type: 'TopologicalSpace α' },
        ],
        target: 'IsClosed (Set.univ : Set α)',
      },
    },
  ])

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

    await page.getByRole('button', { name: 'Build' }).click()
    await expect(page.getByText('Build completed')).toBeVisible()
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