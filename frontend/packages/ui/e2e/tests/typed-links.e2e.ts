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

  test('a type that extends another published type shows both field sets', async ({page}) => {
    // Mammal (a page of the world) extends Animal (another page) by URL: the animal fields must
    // appear alongside the mammal ones, which needs the parent type fetched, not just the child.
    await openHarness(page, {name: 'Cat', attributesSchema: `${WORLD}/types/mammal`})
    for (const field of ['diet', 'habitat', 'hasFur', 'gestationDays']) {
      await expect(page.getByRole('treeitem', {name: new RegExp(`^${field}`)}).first()).toBeVisible()
    }
    // The inherited enum keeps its control: a dropdown, not a text field.
    await expect(page.getByRole('treeitem', {name: /^diet/}).first().getByRole('combobox')).toBeVisible()
  })

  test('the schema editor finds a target type by searching schema pages', async ({page}) => {
    await openHarness(page, {name: 'X'})
    await page.getByRole('button', {name: 'Define schema'}).click()
    const dialog = page.getByRole('dialog', {name: /New object/})
    await expect(dialog).toBeVisible()

    await dialog.getByRole('button', {name: 'Add field'}).click()
    await dialog.getByRole('textbox', {name: 'Field name'}).first().fill('mother')
    await dialog.getByRole('textbox', {name: 'Type of mother'}).click()
    await page
      .getByTestId('schema-type-option')
      .filter({has: page.getByText('HM link', {exact: true})})
      .click()

    // The target is a search over schema pages: "mam" offers the world's Mammal type.
    await dialog.getByLabel('Set target type for mother').click()
    await dialog.getByLabel('Target type for mother').fill('mam')
    const results = page.locator('[data-hm-search-results]').getByTestId('hm-search-result')
    await expect(results).toHaveCount(1)
    await expect(results.first()).toContainText('Mammal')
    await results.first().click()
    // Picked: the target shows as the page's title pill, and the published field carries its URL.
    await expect(results).toHaveCount(0)
    await expect(dialog.getByText('Mammal', {exact: true})).toBeVisible()
    await expect(dialog.getByRole('button', {name: 'Remove reference'})).toBeVisible()
    await dialog.getByTestId('linked-object-publish').click()
    await expect(dialog).toBeHidden()
    const published: any = await page.evaluate(() => (window as any).__lastPublishedSchema)
    expect(published.properties.mother).toMatchObject({value: {format: 'hm-url', target: `${WORLD}/types/mammal`}})
  })

  test('an account field searches accounts and normalises a pasted principal', async ({page}) => {
    const ALICE = 'z6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4'
    await openHarness(page, {
      name: 'Rex',
      attributesSchema: `${WORLD}/types/animal`,
      diet: 'carnivore',
      habitat: 'yard',
    })
    const keeper = page.getByRole('treeitem', {name: /^keeper/}).first()
    const input = keeper.getByPlaceholder(/Search accounts/)
    await expect(input).toBeVisible()

    // Search offers accounts (the mention picker's account candidates), each with its avatar.
    await input.fill('ali')
    const results = page.locator('[data-hm-search-results]').getByTestId('hm-search-result')
    await expect(results).toHaveCount(1)
    await expect(results.first()).toContainText('Alice Keeper')
    await expect(results.first().locator('img[alt="Alice Keeper"]')).toHaveCount(1)
    await results.first().click()
    await expect.poll(async () => (await meta(page)).keeper).toBe(`hm://${ALICE}`)

    // The pill shows the account's name and avatar (its home document's icon), and opens the profile.
    const pill = keeper.getByTestId('hm-entity-pill')
    await expect(pill).toContainText('Alice Keeper')
    await expect(pill.locator('img[alt="Alice Keeper"]')).toHaveCount(1)
    await keeper.getByRole('button', {name: /Alice Keeper/}).click()
    await expect.poll(() => page.evaluate(() => (window as any).__openedUrl)).toBe(`hm://${ALICE}`)

    // Clear, then paste the bare principal: stored as the same URL.
    await keeper.getByRole('button', {name: 'Remove reference'}).click()
    await keeper.getByPlaceholder(/Search accounts/).fill(ALICE)
    await keeper.getByPlaceholder(/Search accounts/).press('Enter')
    await expect.poll(async () => (await meta(page)).keeper).toBe(`hm://${ALICE}`)
    await expect(page.getByRole('alert').getByText(/keeper/)).toHaveCount(0)
  })

  test('several accounts are a list of account items, each searchable and removable', async ({page}) => {
    const ALICE = 'z6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4'
    await openHarness(page, {
      name: 'Rex',
      attributesSchema: `${WORLD}/types/animal`,
      diet: 'carnivore',
      habitat: 'yard',
    })
    const keepers = page.getByRole('treeitem', {name: /^keepers/}).first()
    await expect(keepers).toBeVisible()
    // A new item of an account list is an account search, not a text box.
    await keepers.getByRole('button', {name: 'Add item'}).click()
    const input = keepers.getByPlaceholder(/Search accounts/)
    await expect(input).toBeVisible()
    await input.fill('ali')
    const results = page.locator('[data-hm-search-results]').getByTestId('hm-search-result')
    await expect(results).toHaveCount(1)
    await results.first().click()
    await expect.poll(async () => (await meta(page)).keepers).toEqual([`hm://${ALICE}`])
    await expect(keepers.getByTestId('hm-entity-pill')).toContainText('Alice Keeper')

    // Items come and go like any list's: the item menu removes it.
    await keepers.getByRole('button', {name: 'Actions for item 1'}).click()
    await page.getByRole('menuitem', {name: 'Remove item'}).click()
    await expect.poll(async () => (await meta(page)).keepers).toEqual([])
  })

  test('the schema editor offers an Account kind that includes the library type', async ({page}) => {
    await openHarness(page, {name: 'X'})
    await page.getByRole('button', {name: 'Define schema'}).click()
    const dialog = page.getByRole('dialog', {name: /New object/})
    await dialog.getByRole('button', {name: 'Add field'}).click()
    await dialog.getByRole('textbox', {name: 'Field name'}).first().fill('owner')
    await dialog.getByRole('textbox', {name: 'Type of owner'}).click()
    await page
      .getByTestId('schema-type-option')
      .filter({has: page.getByText('Account', {exact: true})})
      .click()
    await expect(dialog.getByRole('textbox', {name: 'Type of owner'})).toHaveValue('Account')
    await dialog.getByTestId('linked-object-publish').click()
    await expect(dialog).toBeHidden()
    const published: any = await page.evaluate(() => (window as any).__lastPublishedSchema)
    expect(published.properties.owner).toEqual({value: {type: `${LIBRARY}/account`}, required: true})
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
