import {expect, test, type Page} from '@playwright/test'

/**
 * E2E suite for the Onyx schema-editor UI (DocumentMetadataView + the struct
 * SchemaEditorDialog + the value-editor add-field flow). Runs against the
 * isolated @shm/ui Vite harness (e2e/test-app), which mounts the REAL
 * components with a local metadata state and a mock universal client.
 *
 * Tests read/mutate the harness through window hooks exposed by TestSchemaEditor:
 *   window.__meta()      -> current staged metadata
 *   window.__schemaCid() -> published CID of a bundled schema (no fetch)
 *   window.__lastPublishedSchema / __publishedSchemas -> decoded published blobs
 */

type Meta = Record<string, unknown>

/** Load the harness with an optional seeded initial metadata. */
async function openHarness(page: Page, initialMeta?: Meta) {
  if (initialMeta) {
    await page.addInitScript((meta) => {
      ;(window as any).__initialMeta = meta
    }, initialMeta)
  }
  await page.goto('/')
  await expect(page.getByTestId('schema-editor-harness')).toBeVisible()
  // Wait for the window hooks to be installed.
  await page.waitForFunction(() => typeof (window as any).__meta === 'function')
}

const meta = (page: Page) => page.evaluate(() => (window as any).__meta() as Meta)
const bundledEmployeeCid = (page: Page) =>
  page.evaluate(() => (window as any).__schemaCid('example-employee') as string)

/** The struct schema-editor dialog (accessible name comes from its DialogTitle). */
const defineDialog = (page: Page) => page.getByRole('dialog', {name: 'Define a type'})
const editDialog = (page: Page) => page.getByRole('dialog', {name: 'Edit schema'})

/** Open the "Add field" dialog from the DocumentMetadataView add-field form. */
async function openAddFieldDialog(page: Page) {
  await page.getByRole('button', {name: 'Add field'}).first().click()
  await expect(page.getByRole('dialog', {name: 'Add field'})).toBeVisible()
}

test.describe('schema editor', () => {
  test('regression: typing the reserved schemaDefinition key opens the schema editor and stages NOTHING', async ({
    page,
  }) => {
    await openHarness(page, {name: 'Foo'})
    await openAddFieldDialog(page)

    // Type the reserved key as a field name.
    await page.getByLabel('Field name').fill('schemaDefinition')

    // The struct schema editor dialog opens instead...
    await expect(defineDialog(page)).toBeVisible()
    // ...and no empty `schemaDefinition` string is staged into the metadata.
    expect(await meta(page)).not.toHaveProperty('schemaDefinition')
    expect(await meta(page)).toEqual({name: 'Foo'})
  })

  test('define a new type via the struct form -> stages an ipfs:// schemaDefinition', async ({page}) => {
    await openHarness(page, {name: 'X', schemaDefinition: ''})

    // The schemaDefinition row (empty value) offers to define a schema.
    await page.getByRole('button', {name: 'Define schema'}).click()
    const dialog = defineDialog(page)
    await expect(dialog).toBeVisible()

    // Name the type.
    await dialog.getByPlaceholder('e.g. Employee').fill('Widget')

    // Add a field, rename it, choose a kind, mark it required.
    await dialog.getByRole('button', {name: 'Add field'}).click()
    const fieldName = dialog.getByRole('textbox', {name: 'Field name'})
    await expect(fieldName).toHaveValue('field')
    await fieldName.fill('width')

    // Radix Select: open + pick "Whole number" (integer).
    await dialog.getByRole('combobox').click()
    await page.getByRole('option', {name: 'Whole number'}).click()
    await expect(dialog.getByRole('combobox')).toContainText('Whole number')

    const required = dialog.getByRole('checkbox')
    await required.click()
    await expect(required).toHaveAttribute('aria-checked', 'true')

    await expect(dialog.getByText('✓ valid schema')).toBeVisible()
    await dialog.getByRole('button', {name: 'Create type'}).click()

    // Dialog closes; schemaDefinition becomes an ipfs:// pointer.
    await expect(dialog).toBeHidden()
    const m = await meta(page)
    expect(typeof m.schemaDefinition).toBe('string')
    expect(m.schemaDefinition as string).toMatch(/^ipfs:\/\/[a-z0-9]+$/i)

    // The published schema carried the field, kind, and required flag.
    const published = await page.evaluate(() => (window as any).__lastPublishedSchema)
    expect(published).toMatchObject({
      name: 'Widget',
      properties: {width: {type: 'hm://hyper.media/integer'}},
      required: ['width'],
    })
  })

  test('schemaDefinition row: empty value shows "Define schema" (enabled)', async ({page}) => {
    await openHarness(page, {name: 'X', schemaDefinition: ''})
    const define = page.getByRole('button', {name: 'Define schema'})
    await expect(define).toBeVisible()
    await expect(define).toBeEnabled()
    // No "Edit schema" affordance when there is no schema yet.
    await expect(page.getByRole('button', {name: 'Edit schema'})).toHaveCount(0)
  })

  test('schemaDefinition row: a bundled schema CID shows "Edit schema" (enabled) and names the type', async ({
    page,
  }) => {
    await openHarness(page)
    const cid = await bundledEmployeeCid(page)
    expect(cid).toBeTruthy()

    await openHarness(page, {name: 'X', schemaDefinition: `ipfs://${cid}`})
    const edit = page.getByRole('button', {name: 'Edit schema'})
    await expect(edit).toBeVisible()
    await expect(edit).toBeEnabled()
    // The bundled schema resolves synchronously, so the row names the type.
    await expect(page.getByText('Employee', {exact: true})).toBeVisible()
  })

  test('schemaDefinition row: "Remove schema" deletes the field', async ({page}) => {
    await openHarness(page)
    const cid = await bundledEmployeeCid(page)
    await openHarness(page, {name: 'X', schemaDefinition: `ipfs://${cid}`})

    await page.getByRole('button', {name: 'Remove schema'}).click()
    expect(await meta(page)).not.toHaveProperty('schemaDefinition')
    expect(await meta(page)).toEqual({name: 'X'})
  })

  test('struct mechanics: add multiple fields, remove one, required reflected in the published schema', async ({
    page,
  }) => {
    await openHarness(page, {name: 'X', schemaDefinition: ''})
    await page.getByRole('button', {name: 'Define schema'}).click()
    const dialog = defineDialog(page)
    await expect(dialog).toBeVisible()

    await dialog.getByPlaceholder('e.g. Employee').fill('Point')

    // Add + rename first field.
    await dialog.getByRole('button', {name: 'Add field'}).click()
    await dialog.getByRole('textbox', {name: 'Field name'}).first().fill('x')

    // Add + rename second field (new field defaults to "field" since "x" exists).
    await dialog.getByRole('button', {name: 'Add field'}).click()
    await expect(dialog.getByRole('textbox', {name: 'Field name'})).toHaveCount(2)
    await dialog.getByRole('textbox', {name: 'Field name'}).nth(1).fill('y')

    // Mark "x" required.
    await dialog.getByRole('checkbox').first().click()

    // Remove "y".
    await dialog.getByRole('button', {name: 'Remove y'}).click()
    await expect(dialog.getByRole('textbox', {name: 'Field name'})).toHaveCount(1)
    await expect(dialog.getByRole('textbox', {name: 'Field name'})).toHaveValue('x')

    await dialog.getByRole('button', {name: 'Create type'}).click()
    await expect(dialog).toBeHidden()

    const published: any = await page.evaluate(() => (window as any).__lastPublishedSchema)
    expect(Object.keys(published.properties)).toEqual(['x'])
    expect(published.required).toEqual(['x'])
    expect(published.properties.y).toBeUndefined()
  })

  test('field-name input keeps focus while typing character-by-character (no blur-per-keystroke)', async ({page}) => {
    // Regression: renaming on every keystroke re-keyed the row and remounted it,
    // blurring the input so only one char could be typed. `.fill()` hides this
    // (single op), so type char-by-char and assert focus survives.
    await openHarness(page, {name: 'X', schemaDefinition: ''})
    await page.getByRole('button', {name: 'Define schema'}).click()
    const dialog = defineDialog(page)
    await dialog.getByPlaceholder('e.g. Employee').fill('Comp')
    await dialog.getByRole('button', {name: 'Add field'}).click()

    const fieldName = dialog.getByRole('textbox', {name: 'Field name'})
    await fieldName.click()
    await fieldName.press('ControlOrMeta+a')
    await fieldName.pressSequentially('salary', {delay: 15})

    // The whole word landed AND the input never lost focus mid-type.
    await expect(fieldName).toBeFocused()
    await expect(fieldName).toHaveValue('salary')

    // Commit on blur → the property is renamed.
    await fieldName.blur()
    await dialog.getByRole('button', {name: 'Create type'}).click()
    const published: any = await page.evaluate(() => (window as any).__lastPublishedSchema)
    expect(Object.keys(published.properties)).toEqual(['salary'])
  })

  test('JSON toggle: switch to raw JSON view and back to the struct form', async ({page}) => {
    await openHarness(page, {name: 'X', schemaDefinition: ''})
    await page.getByRole('button', {name: 'Define schema'}).click()
    const dialog = defineDialog(page)
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder('e.g. Employee').fill('Thing')

    // Struct form is shown first (the "Type name" field + "Add field").
    await expect(dialog.getByText('Type name')).toBeVisible()

    // Toggle to JSON: the struct-only "Type name" label disappears and the
    // toggle flips to "Form" (the raw OnyxDataEditor is now shown).
    await dialog.getByRole('button', {name: 'JSON'}).click()
    await expect(dialog.getByText('Type name')).toHaveCount(0)
    await expect(dialog.getByRole('button', {name: 'Form'})).toBeVisible()

    // Toggle back to the form.
    await dialog.getByRole('button', {name: 'Form'}).click()
    await expect(dialog.getByText('Type name')).toBeVisible()
    await expect(dialog.getByRole('button', {name: 'JSON'})).toBeVisible()
  })

  test('required field of the document type is an always-visible row; optional fields are add suggestions', async ({
    page,
  }) => {
    await openHarness(page)
    const cid = await bundledEmployeeCid(page)
    await openHarness(page, {name: 'X', schemaDefinition: `ipfs://${cid}`})

    // The Employee schema requires employeeId — it renders as an always-visible
    // required row (seeded if absent), so it never has to be "added".
    await expect(page.getByText('employeeId', {exact: true})).toBeVisible()
    // The seeded value is shown but NOT written to the draft (no auto-pollution).
    expect(await meta(page)).toEqual({name: 'X', schemaDefinition: `ipfs://${cid}`})

    // A required field cannot be removed: its actions menu has no Remove item.
    await page.getByRole('button', {name: 'Actions for employeeId'}).click()
    await expect(page.getByRole('menuitem', {name: 'Edit field'})).toBeVisible()
    await expect(page.getByRole('menuitem', {name: 'Remove employeeId'})).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Optional declared fields are still offered as add-field suggestions, and
    // the required one is NOT re-offered (it's already shown as a row).
    await openAddFieldDialog(page)
    const dialog = page.getByRole('dialog', {name: 'Add field'})
    await expect(dialog.getByText('Schema fields')).toBeVisible()
    await expect(dialog.getByRole('button', {name: 'department', exact: true})).toBeVisible()
    await expect(dialog.getByRole('button', {name: 'employeeId *'})).toHaveCount(0)
  })

  // --- extra coverage: metadata field add / rename / remove ------------------

  test('add a plain metadata field via the add-field dialog', async ({page}) => {
    await openHarness(page, {name: 'Foo'})
    await openAddFieldDialog(page)
    await page.getByLabel('Field name').fill('summary')
    await page.getByRole('dialog', {name: 'Add field'}).getByRole('button', {name: 'Add', exact: true}).click()

    await expect(page.getByRole('dialog', {name: 'Add field'})).toBeHidden()
    const m = await meta(page)
    expect(m).toHaveProperty('summary')
    expect(m.name).toBe('Foo')
  })

  test('remove a metadata field via the row actions menu', async ({page}) => {
    await openHarness(page, {name: 'Foo', summary: 'a note'})
    // Open the row actions menu for "summary" and remove it.
    await page.getByRole('button', {name: 'Actions for summary'}).click()
    await page.getByRole('menuitem', {name: 'Remove summary'}).click()

    expect(await meta(page)).not.toHaveProperty('summary')
    expect(await meta(page)).toEqual({name: 'Foo'})
  })

  test('rename a metadata field via the row edit dialog', async ({page}) => {
    await openHarness(page, {name: 'Foo', nickname: 'Bar'})
    await page.getByRole('button', {name: 'Actions for nickname'}).click()
    await page.getByRole('menuitem', {name: 'Edit field'}).click()

    const dialog = page.getByRole('dialog', {name: 'Edit field'})
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Field name').fill('alias')
    await dialog.getByRole('button', {name: 'Save', exact: true}).click()

    const m = await meta(page)
    expect(m).not.toHaveProperty('nickname')
    expect(m.alias).toBe('Bar')
  })

  test('JSON metadata editor: edit whole-document metadata and apply', async ({page}) => {
    await openHarness(page, {name: 'Foo'})
    await page.getByRole('button', {name: 'Edit as JSON'}).click()

    const textarea = page.getByRole('textbox')
    await textarea.fill(JSON.stringify({name: 'Renamed', count: 3}, null, 2))
    await page.getByRole('button', {name: 'Apply changes'}).click()

    expect(await meta(page)).toEqual({name: 'Renamed', count: 3})
  })

  test('attach-schema bar rejects a non-CID value', async ({page}) => {
    await openHarness(page, {name: 'Foo'})
    await page.getByRole('button', {name: 'Attach schema field'}).click()
    const input = page.getByPlaceholder('Schema CID or ipfs:// URL')
    await input.fill('not-a-cid')
    await page.getByRole('button', {name: 'Attach', exact: true}).click()
    await expect(page.getByText(/Enter a schema CID/)).toBeVisible()
    // Nothing staged.
    expect(await meta(page)).toEqual({name: 'Foo'})
  })
})
