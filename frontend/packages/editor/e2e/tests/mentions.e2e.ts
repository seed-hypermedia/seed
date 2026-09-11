import {expect, test, type Page} from '@playwright/test'

async function openEditor(page: Page) {
  await page.goto('/?real=1&fixture=empty')
  await page.waitForFunction(() => !!window.TEST_EDITOR && !!window.TEST_MACHINE)
  await page.evaluate(() => window.TEST_MACHINE.send({type: 'edit.start'}))
  const paragraph = page.locator('[data-id="p-empty"] [data-content-type="paragraph"]')
  await paragraph.click()
  await expect(page.locator('.ProseMirror').first()).toHaveAttribute('contenteditable', 'true')
}

test('account and home-document mentions have distinct stored destinations', async ({page}) => {
  await openEditor(page)
  await page.keyboard.type('@Alice')
  await expect(page.getByRole('option', {name: /Alice/}).first()).toBeVisible()
  await expect(page.getByRole('option', {name: /Alice/}).first()).toBeEnabled()
  await expect(page.getByRole('option', {name: /Alice/}).first()).toContainText('Published 2m ago · Site editor')
  await page.keyboard.press('Enter')
  const account = page.locator('[data-inline-embed]').first()
  await expect(account).toContainText('@Alice')
  await expect(account).toHaveAttribute('data-inline-embed', /\/:profile$/)
  await page.keyboard.type('[[Home')
  await expect(page.getByRole('option', {name: /Home/}).first()).toBeVisible()
  await expect(page.getByRole('option', {name: /Home/}).first()).toBeEnabled()
  await page.keyboard.press('Enter')
  const document = page.locator('[data-inline-embed]').nth(1)
  await expect(document).not.toContainText('@')
  await expect(document).toHaveAttribute('data-inline-embed', /\?v=v-current&l$/)
  const mentions = await page.evaluate(() => {
    const result: {link: string; mentionKind: string}[] = []
    window.TEST_EDITOR.editor!._tiptapEditor.state.doc.descendants((node: any) => {
      if (node.type.name === 'inline-embed') result.push(node.attrs)
    })
    return result
  })
  expect(mentions.map((mention) => mention.mentionKind)).toEqual(['account', 'document'])
  expect(mentions[1]!.link).not.toContain(':profile')
  const savedKinds = await page.evaluate(() =>
    window.TEST_EDITOR.getBlocks().flatMap((block: any) =>
      (block.content || []).filter((item: any) => item.type === 'inline-embed').map((item: any) => item.mentionKind),
    ),
  )
  expect(savedKinds).toEqual(['account', 'document'])
})

test('cancelling an autocomplete preserves the typed query', async ({page}) => {
  await openEditor(page)
  await page.keyboard.type('[[Home')
  await expect(page.getByRole('option', {name: /Home/}).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.locator('[data-id="p-empty"]')).toContainText('[[Home')
  await expect(page.locator('[data-inline-embed]')).toHaveCount(0)
})

test('comment mentions select without submitting the comment', async ({page}) => {
  await page.goto('/?real=1&comment=1&thread=1')
  const composer = page.locator('[data-testid="comment-harness"] .ProseMirror')
  await composer.click()
  await page.keyboard.type('@Alice')
  await expect(page.getByRole('option', {name: /Alice/}).first()).toBeEnabled()
  await expect(page.getByRole('option', {name: /Alice/}).first()).toContainText('Replied 2m ago · Replying to')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-inline-embed]').first()).toHaveAttribute('data-inline-embed', /\/:profile$/)
  await page.keyboard.type('[[Home')
  await expect(page.getByRole('option', {name: /Home/}).first()).toBeEnabled()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-inline-embed]').nth(1)).toHaveAttribute('data-inline-embed', /\?v=v-current&l$/)
  await expect(page.getByTestId('comment-harness')).not.toHaveAttribute('data-submitted', 'true')
})

test.describe('mobile mention picker', () => {
  test.use({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})

  test('opens a dedicated account picker and inserts at the saved caret', async ({page}) => {
    await openEditor(page)
    await page.keyboard.insertText('@')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('animation-name', 'mention-mobile-in')
    await dialog.getByRole('textbox').fill('Alice')
    await expect(dialog.getByRole('option', {name: /Alice/}).first()).toContainText('Published 2m ago · Site editor')
    await dialog.getByRole('option', {name: /Alice/}).first().click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('[data-inline-embed]').first()).toHaveAttribute('data-inline-embed', /\/:profile$/)
    await page.keyboard.insertText('after')
    await expect(page.locator('[data-id="p-empty"]')).toContainText('after')
    await page.emulateMedia({reducedMotion: 'reduce'})
    await page.keyboard.insertText(' @')
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveCSS('animation-name', 'none')
    await dialog.getByRole('button', {name: 'Cancel mention'}).click()
    await expect(page.locator('.ProseMirror').first()).toBeFocused()
  })

  test('comment toolbar opens a document-only picker', async ({page}) => {
    await page.goto('/?real=1&comment=1')
    await page.locator('[data-testid="comment-harness"] .ProseMirror').click()
    await page.getByRole('button', {name: 'Link document', exact: true}).last().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', {name: 'Link document'})).toBeVisible()
    await dialog.getByRole('textbox').fill('Home')
    await dialog.getByRole('option', {name: /Home/}).first().click()
    await expect(dialog).toHaveCount(0)
    await expect(page.locator('[data-inline-embed]').first()).toHaveAttribute('data-inline-embed', /\?v=v-current&l$/)
  })
})

test('popover motion respects reduced motion and does not restart on search updates', async ({page}) => {
  await openEditor(page)
  await page.keyboard.type('@')
  const box = page.locator('.tippy-box[data-animation="mention-popover"]')
  await expect(box).toBeVisible()
  await expect(box).toHaveCSS('transition-duration', '0.18s')
  await page.keyboard.type('Alice')
  await expect(page.getByRole('option', {name: /Alice/}).first()).toBeEnabled()
  await expect(box).toHaveAttribute('data-state', 'visible')
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)
  await expect(page.locator('.ProseMirror').first()).toBeFocused()

  await page.emulateMedia({reducedMotion: 'reduce'})
  await page.keyboard.press('Space')
  await page.keyboard.type('@')
  await expect(box).toBeVisible()
  await expect(box).toHaveCSS('transition-duration', '0s')
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)
})

test('inserted comment mentions follow the selected viewer petnames without changing their target', async ({page}) => {
  await page.goto('/?real=1&comment=1&petnames=1')
  await page.locator('[data-testid="comment-harness"] .ProseMirror').click()
  await page.keyboard.type('@burdi')
  await expect(page.getByRole('option', {name: /Burdi/}).first()).toBeEnabled()
  await page.keyboard.press('Enter')
  const mention = page.locator('[data-inline-embed]').first()
  await expect(mention).toContainText('@Burdi')
  const destination = await mention.getAttribute('data-inline-embed')
  await page.evaluate(() => (window as any).TEST_SELECT_MENTION_ACCOUNT('viewer-b'))
  await expect(mention).toContainText('@Buddy')
  await page.evaluate(() => (window as any).TEST_SELECT_MENTION_ACCOUNT(null))
  await expect(mention).toContainText('@Alice')
  await page.evaluate(() => (window as any).TEST_SELECT_MENTION_ACCOUNT('viewer-a'))
  await expect(mention).toContainText('@Burdi')
  await expect(mention).toHaveAttribute('data-inline-embed', destination!)
})
