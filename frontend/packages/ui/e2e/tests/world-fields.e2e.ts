import {expect, test, type Page} from '@playwright/test'

/**
 * E2E for the world-builder field types in the REAL DocumentMetadataView:
 *   - a `format: date` field is authored with a date picker (ISO YYYY-MM-DD);
 *   - an `ipfs` field with a `target` creates a linked OBJECT locked to that
 *     type, gated on validity, and the field then shows the object pill;
 *   - an `ipfs` field without a target creates a free-form object;
 *   - the schema editor offers Date fields and a target type for references.
 * Runs against the @shm/ui harness (e2e/test-app) with a mock client.
 */

type Meta = Record<string, unknown>
const ONYX = 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

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

async function openAddFieldDialog(page: Page) {
  await page.getByRole('button', {name: 'Add field'}).first().click()
  await expect(page.getByRole('dialog', {name: 'Add field'})).toBeVisible()
}

/** Open the schema form for an empty schemaDefinition field (the object dialog, locked to the meta-schema). */
async function openDefineDialog(page: Page) {
  await page
    .getByRole('treeitem', {name: /^schemaDefinition/})
    .first()
    .getByRole('button', {name: 'Create linked object'})
    .click()
  const dialog = page.getByRole('dialog', {name: /New object/})
  await expect(dialog).toBeVisible()
  return dialog
}

/** Add one of the conformance schema's optional declared fields. */
async function addSchemaField(page: Page, name: string) {
  await openAddFieldDialog(page)
  const dialog = page.getByRole('dialog', {name: 'Add field'})
  await dialog.getByRole('button', {name, exact: true}).click()
  await dialog.getByRole('button', {name: 'Add', exact: true}).click()
  await expect(dialog).toBeHidden()
}

test.describe('world-builder field types', () => {
  test('a date field is a date picker that writes an ISO date', async ({page}) => {
    // A character page: `born` (date) and `role` (enum) are required rows.
    await openHarness(page, {name: 'The Wanderer', schema: `${ONYX}/example-character-doc`})
    const born = page.getByRole('treeitem', {name: /born/}).first()
    await expect(born).toBeVisible()
    const picker = born.getByTestId('date-field')
    await expect(picker).toBeVisible()
    await expect(picker).toContainText('Pick a date')

    await picker.click()
    // Pick the 15th of the shown month.
    const day = page.locator('[role="gridcell"] button', {hasText: /^15$/}).first()
    await expect(day).toBeVisible()
    await day.click()

    await expect.poll(async () => (await meta(page)).born).toMatch(/^\d{4}-\d{2}-15$/)
    // The picker now shows the readable date, and validation has nothing to say about it.
    await expect(born.getByTestId('date-field')).toContainText(/15/)
    await expect(page.getByRole('alert').getByText(/born/)).toHaveCount(0)
  })

  test('a typed-object field creates a linked object locked to its target and shows the object pill', async ({
    page,
  }) => {
    await openHarness(page, {
      name: 'The Wanderer',
      schema: `${ONYX}/example-character-doc`,
      born: '0969-01-01',
      role: 'hero',
    })
    await addSchemaField(page, 'stats')
    const stats = page.getByRole('treeitem', {name: /^stats/}).first()
    await expect(stats).toBeVisible()

    await stats.getByRole('button', {name: 'Create linked object'}).click()
    const dialog = page.getByRole('dialog', {name: /New object/})
    await expect(dialog).toBeVisible()
    // Locked to the target type — no schema picker, and publish waits for a valid value.
    await expect(dialog.getByTestId('linked-object-target')).toContainText('Character stats')
    await expect(dialog.getByTestId('linked-object-target')).toContainText('required')
    await expect(dialog.getByLabel('Object schema')).toHaveCount(0)
    const publish = dialog.getByTestId('linked-object-publish')
    await expect(publish).toBeDisabled()

    // Fill the three required 1–10 stats.
    const numbers = dialog.locator('input[type="number"]')
    await expect(numbers).toHaveCount(3)
    for (let i = 0; i < 3; i++) await numbers.nth(i).fill(String(5 + i))
    await expect(dialog).toContainText('conforms to schema')
    await expect(publish).toBeEnabled()
    await publish.click()
    await expect(dialog).toBeHidden()

    // The field now references the published object, shown as an object pill with an edit action.
    await expect.poll(async () => (await meta(page)).stats).toMatch(/^ipfs:\/\/bafyrei/)
    await expect(stats.getByTestId('ipfs-object-pill')).toBeVisible()
    // The published blob is the stats value, self-described by a `schema` link.
    // (Stringify the CID link in-page: a CID object does not survive structured clone.)
    const published: any = await page.evaluate(() => {
      const blob = (window as any).__lastPublishedSchema
      return {...blob, schema: String(blob.schema)}
    })
    expect(published.strength).toBe(5)
    expect(published.charisma).toBe(7)
    expect(published.schema).toMatch(/^bafyrei/)
  })

  test('an untyped object field creates free-form data', async ({page}) => {
    await openHarness(page, {
      name: 'The Wanderer',
      schema: `${ONYX}/example-character-doc`,
      born: '0969-01-01',
      role: 'hero',
    })
    await addSchemaField(page, 'notes')
    const notes = page.getByRole('treeitem', {name: /^notes/}).first()
    await notes.getByRole('button', {name: 'Create linked object'}).click()
    const dialog = page.getByRole('dialog', {name: /New object/})
    await expect(dialog).toBeVisible()
    // No target: a schema picker, defaulting to free-form, and publish is allowed right away.
    await expect(dialog.getByLabel('Object schema')).toBeVisible()
    await expect(dialog).toContainText('Free-form')
    await expect(dialog.getByTestId('linked-object-publish')).toBeEnabled()
    await dialog.getByTestId('linked-object-publish').click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await meta(page)).notes).toMatch(/^ipfs:\/\/bafyrei/)
    await expect(notes.getByTestId('ipfs-object-pill')).toBeVisible()
  })

  test('the schema editor offers Date fields and a target type for references', async ({page}) => {
    await openHarness(page, {name: 'X', schemaDefinition: ''})
    const dialog = await openDefineDialog(page)
    await dialog.getByPlaceholder('e.g. Employee').fill('Quest')

    // A Date field.
    await dialog.getByRole('button', {name: 'Add field'}).click()
    await dialog.getByRole('textbox', {name: 'Field name'}).first().fill('due')
    await dialog.getByRole('combobox').first().click()
    await page.getByRole('option', {name: 'Date', exact: true}).click()

    // An HM link with a target type.
    await dialog.getByRole('button', {name: 'Add field'}).click()
    await dialog.getByRole('textbox', {name: 'Field name'}).nth(1).fill('giver')
    await dialog.getByRole('combobox').nth(1).click()
    await page.getByRole('option', {name: 'HM link'}).click()
    await dialog.getByLabel('Target type for giver').fill(`${ONYX}/example-character-doc`)

    await dialog.getByTestId('linked-object-publish').click()
    await expect(dialog).toBeHidden()
    const published: any = await page.evaluate(() => (window as any).__lastPublishedSchema)
    expect(published.properties.due).toEqual({ref: `${ONYX}/date`})
    expect(published.properties.giver).toMatchObject({format: 'hm-url', target: `${ONYX}/example-character-doc`})
  })

  test('the schema editor can define a signed blob type (extends the envelope, pins a type tag)', async ({page}) => {
    await openHarness(page, {name: 'X', schemaDefinition: ''})
    const dialog = await openDefineDialog(page)
    await dialog.getByPlaceholder('e.g. Employee').fill('Vote')
    await dialog.getByLabel('Signed blob type').click()
    await expect(dialog.getByLabel('Type tag')).toHaveValue('Vote')
    await dialog.getByLabel('Type tag').fill('DocVote')

    await dialog.getByRole('button', {name: 'Add field'}).click()
    await dialog.getByRole('textbox', {name: 'Field name'}).first().fill('choice')
    await dialog.getByTestId('linked-object-publish').click()
    await expect(dialog).toBeHidden()

    const published: any = await page.evaluate(() => (window as any).__lastPublishedSchema)
    expect(published.ref).toBe(`${ONYX}/hypermedia-blob`)
    expect(published.type).toBeUndefined()
    expect(published.properties.type).toEqual({type: `${ONYX}/string`, enum: ['DocVote']})
    expect(published.required).toContain('type')
    expect(Object.keys(published.properties)).toEqual(['type', 'choice'])
  })
})
