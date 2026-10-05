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

test('copies the exact source including indentation and line breaks', async ({page}) => {
  const block = page.locator('[data-id="test-code"]')
  await block.getByRole('button', {name: 'Copy Code', exact: true}).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(source)
  await expect(block.getByRole('button', {name: 'Code Copied', exact: true})).toBeVisible()
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
