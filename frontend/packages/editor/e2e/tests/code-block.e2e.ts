import {expect, test} from './fixtures'

const source = 'graph TD\n  A[Start] --> B[Finish]\n'

test.beforeEach(async ({editorHelpers, page}) => {
  await editorHelpers.waitForEditorReady()
  await page.evaluate((code) => {
    const editor = window.TEST_EDITOR.editor!
    editor.insertBlocks(
      [{id: 'test-code', type: 'code-block', props: {language: 'mermaid'}, content: code}],
      editor.topLevelBlocks[0]!.id,
      'after',
    )
  }, source)
  await page.locator('[data-id="test-code"]').hover()
})

test('shows Mermaid as a diagram by default and preserves editable source', async ({page}) => {
  const block = page.locator('[data-id="test-code"]')
  await expect(block.locator('svg.pele')).toBeVisible()
  await expect(block.locator('pre')).toBeHidden()
  await block.getByRole('button', {name: 'Show Code', exact: true}).click()
  await expect(block.locator('pre')).toBeVisible()
  await expect(block.locator('code')).toHaveText(source)
  await page.evaluate(() => {
    window.TEST_EDITOR.editor!.setTextCursorPosition('test-code', 'end')
    window.TEST_EDITOR.editor!.focus()
  })
  await page.keyboard.type('  C[Done]')
  await block.getByRole('button', {name: 'Preview Diagram', exact: true}).click()
  await expect(block.locator('pre')).toBeHidden()
  await expect(block.locator('svg.pele')).toBeVisible()
  await expect(block.locator('svg.pele')).toContainText('Done')
})

test('reports a copy failure without claiming success', async ({page}) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {value: undefined, configurable: true})
  })
  const block = page.locator('[data-id="test-code"]')
  await block.getByRole('button', {name: 'Copy Code', exact: true}).click()
  await expect(block.getByRole('button', {name: 'Copy Failed. Try Again', exact: true})).toBeVisible()
  await expect(block.getByRole('status')).toHaveText('Copy Failed. Try Again')
})

test('renders multiple diagrams and supports copying in read-only mode', async ({page}) => {
  await page.evaluate(() => {
    const editor = window.TEST_EDITOR.editor!
    editor.insertBlocks(
      [{id: 'second-code', type: 'code-block', props: {language: 'mermaid'}, content: 'graph LR\n  C --> D'}],
      'test-code',
      'after',
    )
    editor.isEditable = false
  })
  await expect(page.locator('[data-id="test-code"] svg.pele')).toBeVisible()
  const block = page.locator('[data-id="second-code"]')
  await expect(block.locator('svg.pele')).toBeVisible()
  await block.getByRole('button', {name: 'Copy Code', exact: true}).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('graph LR\n  C --> D')
  expect(await page.evaluate(() => window.TEST_EDITOR.isEditable())).toBe(false)
})

test('copies the exact source from the diagram and code views', async ({page}) => {
  const block = page.locator('[data-id="test-code"]')
  await block.getByRole('button', {name: 'Copy Code', exact: true}).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
  await expect(block.getByRole('button', {name: 'Code Copied', exact: true})).toBeVisible()
  await block.getByRole('button', {name: 'Show Code', exact: true}).click()
  await page.evaluate(() => {
    window.TEST_EDITOR.editor!.updateBlock('test-code', {
      props: {language: 'plaintext'},
      content: [{type: 'text', text: '  const x = 1;\n\tconsole.log(x);\n', styles: {}}],
    })
  })
  await block.getByRole('button', {name: 'Copy Code', exact: true}).click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('  const x = 1;\n\tconsole.log(x);\n')
})

test('resets preview after language changes, including node updates', async ({page}) => {
  const block = page.locator('[data-id="test-code"]')
  await block.getByRole('button', {name: 'Show Code', exact: true}).click()
  await page.evaluate(() => window.TEST_EDITOR.editor!.updateBlock('test-code', {props: {language: 'plaintext'}}))
  await expect(block.locator('pre')).toBeVisible()
  await block.hover()
  await block.getByRole('button', {name: 'plaintext', exact: true}).click()
  await page.getByRole('button', {name: 'mermaid', exact: true}).click()
  await expect(block.locator('pre')).toBeHidden()
  await expect(block.locator('svg.pele')).toBeVisible()
})

test('allows invalid Mermaid code to be corrected', async ({page}) => {
  const block = page.locator('[data-id="test-code"]')
  await page.evaluate(() =>
    window.TEST_EDITOR.editor!.updateBlock('test-code', {content: [{type: 'text', text: 'not a diagram', styles: {}}]}),
  )
  await expect(block.getByText('Error:', {exact: false})).toBeVisible()
  await block.hover()
  await block.getByRole('button', {name: 'Show Code', exact: true}).click()
  await expect(block.locator('pre')).toBeVisible()
  await page.evaluate(
    (code) => window.TEST_EDITOR.editor!.updateBlock('test-code', {content: [{type: 'text', text: code, styles: {}}]}),
    source,
  )
  await block.getByRole('button', {name: 'Preview Diagram', exact: true}).click()
  await expect(block.locator('svg.pele')).toBeVisible()
})

test('expands a large diagram, zooms and pans, then restores the inline view', async ({page}) => {
  const source = 'flowchart LR\n' + Array.from({length: 30}, (_, i) => `A${i}[Step ${i}] --> A${i + 1}`).join('\n')
  await page.evaluate(
    (code) => window.TEST_EDITOR.editor!.updateBlock('test-code', {content: [{type: 'text', text: code, styles: {}}]}),
    source,
  )
  const block = page.locator('[data-id="test-code"]')
  await expect(block.locator('svg.pele')).toContainText('Step 29')
  await block.hover()
  const expand = block.getByRole('button', {name: 'Expand diagram'})
  await expand.click()
  const dialog = page.getByRole('dialog', {name: 'Diagram', exact: true})
  const diagram = dialog.locator('svg.pele')
  await expect(diagram).toBeVisible()
  await expect(block.locator('svg.pele')).toHaveCount(0)
  const initial = await diagram.getAttribute('viewBox')
  await dialog.getByRole('button', {name: 'Zoom in', exact: true}).click()
  await expect(diagram).not.toHaveAttribute('viewBox', initial!)
  const zoomed = await diagram.getAttribute('viewBox')
  const bounds = (await diagram.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2 - 100, bounds.y + bounds.height / 2, {steps: 5})
  await page.mouse.up()
  await expect(diagram).not.toHaveAttribute('viewBox', zoomed!)
  await dialog.getByRole('button', {name: 'Reset zoom'}).click()
  await expect(diagram).toHaveAttribute('viewBox', initial!)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(expand).toBeFocused()
  await expect(block.locator('svg.pele')).toBeVisible()
  await expand.click()
  await expect(diagram).toHaveAttribute('viewBox', initial!)
  await dialog.getByRole('button', {name: 'Close', exact: true}).click()
  await expect(dialog).toHaveCount(0)
})
