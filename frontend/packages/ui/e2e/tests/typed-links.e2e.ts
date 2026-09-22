import {expect, test, type Page} from '@playwright/test'

/**
 * E2E for typed references — an `hm-url` field with a `target` — in the REAL DocumentMetadataView:
 *   - the field's search offers documents typed by the target or a subtype, folder-typed
 *     children included (through the daemon's effective-schema rule, mirrored by the mock);
 *   - typing narrows the typed results by name, and picking one commits its canonical URL;
 *   - a reference of another type shows an advisory warning, a conforming one does not.
 * Runs against the @shm/ui harness (e2e/test-app) with a mock client that serves a small world.
 */

type Meta = Record<string, unknown>
const LIBRARY = 'hm://hyper.media'
const WORLD = 'hm://z6MkWorldFixture'

async function openHarness(page: Page, initialMeta?: Meta) {
  if (initialMeta) {
    await page.addInitScript((meta) => {
      ;(window as any).__initialMeta = meta
    }, initialMeta)
  }
  await page.goto('/')
  await expect(page.getByTestId('schema-editor-harness')).toBeVisible()
  await page.waitForFunction(() => typeof (window as any).__meta === 'function')
}
const meta = (page: Page) => page.evaluate(() => (window as any).__meta() as Meta)

const character = (extra: Meta = {}): Meta => ({
  name: 'The Wanderer',
  attributesSchema: `${LIBRARY}/example/character-doc`,
  born: '0969-01-01',
  role: 'hero',
  ...extra,
})

test.describe('typed references', () => {
  test('a targeted field searches documents of the target type, folder-typed ones included', async ({page}) => {
    await openHarness(page, character())
    const home = page.getByRole('treeitem', {name: /^home/}).first()
    await expect(home).toBeVisible()
    // The placeholder names the target type.
    const input = home.getByPlaceholder(/Search Place pages/)
    await expect(input).toBeVisible()

    // Focusing an empty field lists the latest Places: the folder-typed Shire and Mordor, not the faction.
    await input.focus()
    const results = page.locator('[data-hm-search-results]').getByTestId('hm-search-result')
    await expect(results).toHaveCount(2)
    await expect(results.filter({hasText: 'The Shire'})).toHaveCount(1)
    await expect(results.filter({hasText: 'Mordor'})).toHaveCount(1)
    await expect(results.filter({hasText: 'Fellowship'})).toHaveCount(0)
    await expect(results.filter({has: page.locator('[data-off-type]')})).toHaveCount(0)

    // Typing narrows by name; picking commits the canonical URL and shows the title pill, unflagged.
    await input.fill('shi')
    await expect(results).toHaveCount(1)
    await results.first().click()
    await expect.poll(async () => (await meta(page)).home).toBe(`${WORLD}/places/shire`)
    await expect(home).toContainText('The Shire')
    await expect(home.getByTestId('hm-target-mismatch')).toHaveCount(0)
  })

  test('a reference outside the target type is flagged, advisory only', async ({page}) => {
    await openHarness(page, character({home: `${WORLD}/factions/fellowship`}))
    const home = page.getByRole('treeitem', {name: /^home/}).first()
    await expect(home).toContainText('The Fellowship')
    const badge = home.getByTestId('hm-target-mismatch')
    await expect(badge).toBeVisible()
    await badge.hover()
    await expect(page.getByRole('tooltip')).toContainText(/Not a Place/)
    // The value stands: the constraint never blocks.
    expect((await meta(page)).home).toBe(`${WORLD}/factions/fellowship`)
  })

  test('a folder-typed document conforms without a binding of its own', async ({page}) => {
    await openHarness(page, character({home: `${WORLD}/places/shire`}))
    const home = page.getByRole('treeitem', {name: /^home/}).first()
    await expect(home).toContainText('The Shire')
    // Give the check time to resolve, then assert it stayed silent.
    await page.waitForTimeout(500)
    await expect(home.getByTestId('hm-target-mismatch')).toHaveCount(0)
  })
})
