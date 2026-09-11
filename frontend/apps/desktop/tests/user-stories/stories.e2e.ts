/**
 * The user stories, in the desktop app. One packaged, isolated app (the `story` worker fixture)
 * with the tester's identity and space already set up; each test drives the real UI and asserts
 * what the tester sees, then verifies persistence by reopening. The steps mirror the "In the app"
 * column of hypermedia/user-stories.md and the testing guide.
 *
 * Coverage: stories 1 (the document model) and 2 (custom metadata) run here, offline, against the
 * tester's own space. The remaining app stories are guided manual tests in user-stories.md — they
 * either browse the public Onyx library (story 1's base-type page, story 7's signed-blob base),
 * which this isolated daemon cannot reach offline, or drive the multi-step schema/blob editors,
 * whose components are covered by the desktop unit tests. The CLI and agent columns of every
 * story are fully automated in tests/user-stories.integration.test.ts.
 */
import {expect, test} from './fixtures'
import {openAddress} from './harness'

const ONYX = 'z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'

test.describe.configure({mode: 'serial'})

test('1. Understand the document model — a document has Attributes and Content', async ({story}) => {
  test.setTimeout(120_000)
  const {win, shot, state} = story
  // Reading the base type page (hm://<onyx>/hypermedia-document) needs the public library and is
  // covered by the CLI/agent suites; offline, the model is visible on the tester's own document:
  // its metadata (the Attributes tab) and its block tree (the Content tab).
  await openAddress(win, `hm://${state.account}`)
  await win.waitForTimeout(1500)
  await expect(win.getByRole('link', {name: /^Attributes/})).toBeVisible({timeout: 30_000})
  await expect(win.getByRole('link', {name: /^Content/}).first()).toBeVisible()
  await shot('story1-document-model')
})

test('2. Give a document custom metadata — add surname on the home doc', async ({story}) => {
  test.setTimeout(120_000)
  const {win, shot, state} = story
  await openAddress(win, `hm://${state.account}`)
  await win.waitForTimeout(1500)
  await win.getByRole('link', {name: /^Attributes/}).click()
  await win.getByRole('button', {name: 'Edit as JSON'}).click()
  const textarea = win.locator('textarea').first()
  await expect(textarea).toBeVisible()
  const current = JSON.parse((await textarea.inputValue()) || '{}')
  await textarea.fill(JSON.stringify({...current, surname: 'Smith'}, null, 2))
  await win.getByRole('button', {name: 'Apply changes'}).click()
  await win.getByRole('button', {name: 'Publish'}).first().click()
  await win.waitForTimeout(3000)
  await shot('story2-published')
  // Reopen from scratch and confirm the attribute persisted (the published doc reads back with
  // its Attributes tab showing the custom field and value).
  await openAddress(win, `hm://${state.account}`)
  await win.waitForTimeout(1500)
  await win.getByRole('link', {name: /^Attributes/}).click()
  await win.waitForTimeout(1000)
  await expect(win.getByText('surname', {exact: false}).first()).toBeVisible({timeout: 30_000})
  await expect(win.getByText('Smith', {exact: false}).first()).toBeVisible()
  await shot('story2-verified')
})
