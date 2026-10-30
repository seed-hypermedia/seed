import {build} from 'vite'
import {chromium} from '@playwright/test'
import {mkdtemp, readFile, readdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const output = await mkdtemp(path.join(tmpdir(), 'seed-embed-gallery-'))
await build({
  configFile: path.join(directory, 'vite.config.ts'),
  build: {
    outDir: output,
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: path.join(directory, 'test-app/EmbedGallery.tsx'),
      name: 'EmbedGallery',
      formats: ['iife'],
      fileName: () => 'gallery.js',
    },
    rollupOptions: {output: {inlineDynamicImports: true}},
  },
})
const files = await readdir(output)
const css = (
  await Promise.all(
    files.filter((file) => file.endsWith('.css')).map((file) => readFile(path.join(output, file), 'utf8')),
  )
).join('\n')
const js = await readFile(path.join(output, 'gallery.js'), 'utf8')
await writeFile(
  path.join(output, 'index.html'),
  `<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./editor.css"></head><body class="bg-background text-foreground"><div id="root"></div><script src="./gallery.js"></script></body></html>`,
)
const browser = await chromium.launch({headless: true})
const page = await browser.newPage({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'})
await page.route('https://embed-review.test/**', (route) =>
  route.fulfill({contentType: 'text/html', body: '<html></html>'}),
)
await page.goto('https://embed-review.test/initial')
const errors = []
page.on('pageerror', (error) => {
  errors.push(error.message)
  console.error(error.message)
})
page.setDefaultTimeout(10000)
await page.setContent(
  '<html><head></head><body class="bg-background text-foreground"><div id="root"></div></body></html>',
)
await page.addStyleTag({content: css})
await page.addScriptTag({content: js})
await page
  .locator('[data-case="Document · full"] .ProseMirror')
  .waitFor()
  .catch(async (error) => {
    console.error(await page.locator('body').innerText())
    throw error
  })
await page.getByText('Alexandra Montgomery Field', {exact: false}).first().waitFor()
const textStyles = () =>
  page.locator('[data-case] .ProseMirror p').evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = getComputedStyle(node)
      return [style.fontFamily, style.fontSize, style.lineHeight]
    }),
  )
for (const label of ['Document · fragment', 'Comment · fragment', 'Reply quote']) {
  const size = await page
    .locator(`[data-case="${label}"] .ProseMirror p`)
    .first()
    .evaluate((node) => getComputedStyle(node).fontSize)
  if (size !== '12px') throw new Error(`${label} compact font was ${size}, expected 12px`)
}
for (const label of ['Document · block', 'Document · fragment', 'Heading · block', 'Comment · fragment']) {
  if (await page.locator(`[data-case="${label}"] .ProseMirror :is(strong, em, code, a, h1, h2)`).count())
    throw new Error(`${label} retained source formatting while collapsed`)
}
if (await page.locator('.bn-block-highlight-focus, .bn-range-highlight-focus').count())
  throw new Error('Unselected embeds have a default highlight')
const imageEmbed = page.locator('[data-case="Image · block"]')
await imageEmbed.getByRole('button', {name: 'Hide full block'}).waitFor()
await imageEmbed.getByRole('button', {name: 'Hide full block'}).click()
const thumbnail = imageEmbed.locator('img')
await thumbnail.evaluate((image) => image.decode())
const thumbnailSize = await thumbnail.boundingBox()
if (
  !thumbnailSize ||
  thumbnailSize.width <= 0 ||
  thumbnailSize.height <= 0 ||
  thumbnailSize.width > 40 ||
  thumbnailSize.height > 40
)
  throw new Error(`Collapsed image exceeds 40 px: ${JSON.stringify(thumbnailSize)}`)
if (Math.abs(thumbnailSize.width / thumbnailSize.height - 0.6) > 0.01)
  throw new Error('Collapsed image lost its aspect ratio')
if (await page.evaluate(() => window.GALLERY_NAVIGATION.length)) throw new Error('Image collapse navigated')
await imageEmbed.locator('[data-content-type="embed"]').click({position: {x: 6, y: 6}})
if ((await page.evaluate(() => window.GALLERY_NAVIGATION.at(-1)?.route?.id?.blockRef)) !== 'image')
  throw new Error('Collapsed image did not open its source')
await page.evaluate(() => {
  window.GALLERY_NAVIGATION.length = 0
})
await imageEmbed.getByRole('button', {name: 'Show full block'}).click()
const commentReferences = page.locator('[data-case="Comment under editing document"] .block-embed')
await commentReferences.first().waitFor()
for (let index = 0; index < 2; index++) {
  const reference = commentReferences.nth(index)
  if ((await reference.getByRole('link', {name: 'Open embedded content'}).count()) !== 1)
    throw new Error(`Read-only comment reference ${index} is disabled by the parent editing state`)
  const historyBefore = await page.evaluate(() => history.length)
  await reference.locator('.truncate').click({position: {x: 2, y: 2}})
  const navigation = await page.evaluate(() => window.GALLERY_NAVIGATION.at(-1))
  if (
    !navigation?.replace ||
    navigation.route.id.blockRef !== 'intro' ||
    navigation.route.panel?.openComment !== 'kept-thread'
  )
    throw new Error('Read-only comment reference failed to replace navigation with its source')
  if (index === 1 && navigation.route.id.blockRange?.start !== 2)
    throw new Error('Read-only comment reference lost its fragment range')
  const hash = await page.evaluate(() => decodeURIComponent(location.hash))
  if (hash !== (index === 1 ? '#intro[2:63]' : '#intro'))
    throw new Error(`Comment reference lost its URL anchor: ${hash}`)
  if ((await page.evaluate(() => history.length)) !== historyBefore)
    throw new Error('Read-only comment reference pushed history')
}
await page.evaluate(() => {
  window.GALLERY_NAVIGATION.length = 0
})
const fragmentText = commentReferences.nth(1).locator('p').first()
const textBox = await fragmentText.boundingBox()
if (!textBox) throw new Error('Missing fragment text for selection check')
await page.mouse.move(textBox.x + 1, textBox.y + textBox.height / 2)
await page.mouse.down()
await page.mouse.move(textBox.x + textBox.width - 1, textBox.y + textBox.height / 2, {steps: 10})
await page.mouse.up()
if (!(await page.evaluate(() => window.getSelection()?.toString()))) throw new Error('Embed text selection was blocked')
if (await page.evaluate(() => window.GALLERY_NAVIGATION.length)) throw new Error('Selecting embed text navigated')
await page.evaluate(() => window.getSelection()?.removeAllRanges())
const hoverTargets = ['Source document', 'Document · full', 'Document · block', 'Document · fragment', 'Reply quote']
const backgrounds = () =>
  Promise.all(
    hoverTargets.map((label) =>
      page
        .locator(`[data-case="${label}"] [data-node-type="blockNode"][data-id="intro"]`)
        .first()
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ),
  )
await page.locator('h1').hover()
const beforeHover = await backgrounds()
await page.locator('[data-case="Document · fragment"] [data-content-type="embed"]').hover()
const duringHover = await backgrounds()
if (duringHover.some((color, index) => color === beforeHover[index]))
  throw new Error(`Hover missed a source instance: ${JSON.stringify({beforeHover, duringHover})}`)
const unrelated = await page
  .locator('[data-case="Comment · whole"] [data-id="intro"]')
  .first()
  .evaluate((node) => getComputedStyle(node).backgroundColor)
if (unrelated !== 'rgba(0, 0, 0, 0)') throw new Error('Hover leaked into an unrelated comment')
await page.locator('h1').hover()
if (JSON.stringify(await backgrounds()) !== JSON.stringify(beforeHover)) throw new Error('Hover did not clear on leave')
const commentCard = page.locator('[data-case="Comment layout"] [data-resourceid]').first()
const commentBackground = await commentCard.evaluate((node) => getComputedStyle(node).backgroundColor)
await page.locator('[data-case="Comment · whole"] [data-content-type="embed"]').hover()
if ((await commentCard.evaluate((node) => getComputedStyle(node).backgroundColor)) === commentBackground)
  throw new Error('Hover did not highlight the source comment')
await page.locator('h1').hover()
if ((await commentCard.evaluate((node) => getComputedStyle(node).backgroundColor)) !== commentBackground)
  throw new Error('Comment hover did not clear')
const historyLength = await page.evaluate(() => history.length)
await page.locator('[data-case="Reply quote"] [data-content-type="embed"]').click({position: {x: 2, y: 2}})
await page.locator('[data-case="Reply quote"] .bn-range-highlight-focus').first().waitFor()
for (const label of ['Document · full', 'Document · block', 'Document · fragment']) {
  await page.locator(`[data-case="${label}"] .bn-range-highlight-focus`).first().waitFor()
}
if (await page.locator('[data-case="Comment · whole"] .bn-range-highlight-focus').count())
  throw new Error('Document selection highlighted an unrelated comment')
const quoteRoute = await page.evaluate(() => window.GALLERY_NAVIGATION.at(-1).route)
if (quoteRoute.id.blockRef !== 'intro' || quoteRoute.id.blockRange.start !== 2 || quoteRoute.id.blockRange.end !== 63)
  throw new Error('Quote navigation lost the source fragment')
if (quoteRoute.panel?.openComment !== 'kept-thread') throw new Error('Quote navigation lost the active thread')
if ((await page.evaluate(() => history.length)) !== historyLength)
  throw new Error('Reference click pushed a history entry')
if (!(await page.evaluate(() => window.GALLERY_NAVIGATION.at(-1).replace)))
  throw new Error('Reference click did not request replace')
if (quoteRoute.id.version || !quoteRoute.id.latest)
  throw new Error('Same-document reference replaced the current version settings')
if (!page.url().includes('panel=comments/kept-thread') || !page.url().includes('#intro[2:63]'))
  throw new Error(`Reference URL lost panel or fragment: ${page.url()}`)
await page.evaluate(() => {
  window.GALLERY_NAVIGATION.length = 0
})
for (const label of ['Image · block', 'Video · block']) {
  await page.locator(`[data-case="${label}"] .embed-media-preview`).click()
  const target = await page.evaluate(() => window.GALLERY_NAVIGATION.at(-1)?.route?.id?.blockRef)
  if (target !== (label.startsWith('Image') ? 'image' : 'video')) throw new Error(`${label} did not open source`)
}
await page.evaluate(() => {
  window.GALLERY_NAVIGATION.length = 0
})
const documentHostStyles = await textStyles()
await page.locator('main').evaluate((node) => node.classList.add('comment-editor', 'is-comment', 'hm-prose'))
const commentHostStyles = await textStyles()
if (JSON.stringify(documentHostStyles) !== JSON.stringify(commentHostStyles))
  throw new Error('Host comment styles changed embedded typography')
await page.locator('main').evaluate((node) => node.classList.remove('comment-editor', 'is-comment', 'hm-prose'))
for (const width of [360, 560, 1000]) {
  const section = page.locator('[data-case="Image · block"]')
  await section.evaluate((node, width) => {
    node.style.width = `${width}px`
  }, width)
  const dimensions = await section.locator('.embed-media-container').evaluate((node) => {
    const preview = node.querySelector('.embed-media-preview').getBoundingClientRect()
    const image = node.querySelector('img').getBoundingClientRect()
    return {
      container: node.getBoundingClientRect().width,
      preview: preview.width,
      previewHeight: preview.height,
      width: image.width,
      height: image.height,
    }
  })
  const maxWidth =
    dimensions.container >= 480 ? Math.min(dimensions.container / 2, 400) : Math.min(dimensions.container, 400)
  if (
    dimensions.preview > maxWidth + 1 ||
    dimensions.previewHeight > 240 ||
    Math.abs(dimensions.width / dimensions.height - 0.6) > 0.01
  )
    throw new Error(`Image preview dimensions incorrect: ${JSON.stringify(dimensions)}`)
  await section.evaluate((node) => {
    node.style.width = ''
  })
}
await page.screenshot({path: path.join(output, 'wide-collapsed.png'), fullPage: true, animations: 'disabled'})
await page.setViewportSize({width: 390, height: 844})
await page.screenshot({path: path.join(output, 'narrow-collapsed.png'), fullPage: true, animations: 'disabled'})
await page.setViewportSize({width: 1280, height: 1000})
const expandButtons = page.getByRole('button', {name: /^Show full/})
const expansionCount = await expandButtons.count()
const alreadyExpandedCount = await page.getByRole('button', {name: /^Hide full/}).count()
if (expansionCount !== 8) throw new Error(`Expected eight quote controls, got ${expansionCount}`)
for (let index = 0; index < expansionCount; index++) await expandButtons.first().click()
if ((await page.getByRole('button', {name: /^Hide full/}).count()) !== expansionCount + alreadyExpandedCount)
  throw new Error('Quotes did not expand')
for (const label of ['Document · fragment', 'Comment · fragment', 'Reply quote']) {
  const highlightedText = await page.locator(`[data-case="${label}"] .bn-range-highlight-focus`).allTextContents()
  if (highlightedText.join('') !== 'shared source should keep its meaning, formatting, and identi')
    throw new Error(`Expanded fragment highlight is wrong in ${label}: ${highlightedText.join('')}`)
}
if (await page.evaluate(() => window.GALLERY_NAVIGATION.length)) throw new Error('Caret triggered navigation')
await page.locator('[data-case="Document · block"] a[href="https://example.com/source"]').click()
const navigation = await page.evaluate(() => window.GALLERY_NAVIGATION)
if (navigation.length !== 1 || navigation[0].url !== 'https://example.com/source')
  throw new Error('Nested source link did not open independently')
const sourceBackground = page.locator('[data-case="Document · block"] [data-content-type="embed"]')
await sourceBackground.click({position: {x: 2, y: 2}})
await page.locator('[data-case="Document · block"]').getByRole('link', {name: 'Open embedded content'}).focus()
await page.keyboard.press('Enter')
for (const modifier of ['Control', 'Meta', 'Shift']) {
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
  if (modifier === 'Control' && process.platform === 'darwin')
    await sourceBackground.dispatchEvent('click', {ctrlKey: true})
  else await sourceBackground.click({position: {x: 2, y: 2}, modifiers: [modifier]})
}
await page.evaluate(() => window.getSelection()?.removeAllRanges())
await sourceBackground.click({position: {x: 2, y: 2}, button: 'middle'})
const sourceNavigation = await page.evaluate(() => window.GALLERY_NAVIGATION)
if (sourceNavigation.filter((entry) => entry.route).length !== 2)
  throw new Error('Background click or keyboard source navigation failed')
if (sourceNavigation.filter((entry) => entry.newWindowRoute).length !== 4)
  throw new Error(`Modified or middle source click failed: ${JSON.stringify(sourceNavigation)}`)
await page.locator('h1').click()
await page.screenshot({path: path.join(output, 'wide-expanded.png'), fullPage: true, animations: 'disabled'})
await page.setViewportSize({width: 390, height: 844})
await page.screenshot({path: path.join(output, 'narrow-expanded.png'), fullPage: true, animations: 'disabled'})
await page.evaluate(() => document.documentElement.classList.add('dark'))
await page.screenshot({path: path.join(output, 'narrow-dark-expanded.png'), fullPage: true, animations: 'disabled'})
const webPage = await browser.newPage({viewport: {width: 1280, height: 1000}, reducedMotion: 'reduce'})
await webPage.context().route('https://example.com/**', (route) => route.abort())
await webPage.setContent(
  '<html><head><base href="https://example.com/"></head><body><div id="root"></div></body></html>',
)
await webPage.addStyleTag({content: css})
await webPage.evaluate(() => {
  window.GALLERY_WEB_NAVIGATION = true
})
await webPage.addScriptTag({content: js})
const webSource = webPage.locator('[data-case="Document · block"] [data-content-type="embed"]')
await webSource.waitFor()
console.log('Web source href:', await webSource.getByRole('link', {name: 'Open embedded content'}).getAttribute('href'))
const webPopups = []
for (const options of [{modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control']}, {button: 'middle'}]) {
  const popupPromise = webPage.context().waitForEvent('page', {timeout: 10000})
  await webSource.click({position: {x: 2, y: 2}, ...options})
  const popup = await popupPromise
  webPopups.push(popup.url())
  await popup.close()
}
if (await webPage.evaluate(() => window.GALLERY_NAVIGATION.length))
  throw new Error('Web new-tab click routed in current page')
await webPage.close()
await writeFile(
  path.join(output, 'review.json'),
  JSON.stringify(
    {
      errors,
      navigation,
      sourceNavigation,
      webPopups,
      documentHostStyles,
      commentHostStyles,
      fixture: true,
      liveApp: false,
      cases: await page.locator('[data-case]').allTextContents(),
    },
    null,
    2,
  ),
)
const threadPage = await browser.newPage({viewport: {width: 1280, height: 800}, reducedMotion: 'reduce'})
threadPage.on('pageerror', (error) => errors.push(error.message))
await threadPage.goto('about:blank')
await threadPage.setContent('<html><body class="bg-background text-foreground"><div id="root"></div></body></html>')
await threadPage.evaluate(() => {
  window.THREAD_REVIEW = true
})
await threadPage.addStyleTag({content: css})
await threadPage.addScriptTag({content: js})
await threadPage.getByText('Root comment', {exact: true}).waitFor()
await threadPage.getByText('Reply 7:', {exact: false}).waitFor()
if ((await threadPage.getByRole('button', {name: 'Reply', exact: true}).count()) !== 8)
  throw new Error('The root must not have a Reply action; all eight replies must retain theirs')
await threadPage.getByRole('button', {name: 'Back to comments'}).waitFor()
if (await threadPage.getByRole('button', {name: 'Expand comments'}).count())
  throw new Error('Thread header retained expand control')
const threadComposer = threadPage.getByTestId('thread-composer')
if (
  (await threadComposer.getAttribute('data-target')) !== 'bafy-gallery-author/comment1' ||
  (await threadComposer.getAttribute('data-version')) !== 'c1'
)
  throw new Error('A selected nested reply or stale route version changed the posting target')
const editorField = threadComposer.locator('.ProseMirror[contenteditable="true"]')
await threadComposer.getByRole('button', {name: 'Write a Reply', exact: true}).click()
await threadPage.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
await threadPage.keyboard.type('Direct reply to root.')
await threadComposer.getByRole('button', {name: 'Send reply'}).click()
await threadPage.getByText('Direct reply to root.', {exact: true}).waitFor()
await editorField.click()
await threadPage.keyboard.type('Keep my draft.')
const threadNavigationBefore = await threadPage.evaluate(() => window.GALLERY_NAVIGATION.length)
const footerBefore = await threadComposer.boundingBox()
await threadPage.getByRole('button', {name: 'Reply', exact: true}).nth(1).click()
await threadComposer.locator('.block-embed').waitFor()
await threadPage.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
await threadPage.getByRole('button', {name: 'Reply', exact: true}).nth(2).click()
await threadPage.waitForFunction(
  () => document.querySelectorAll('[data-testid="thread-composer"] .block-embed').length === 2,
)
await threadPage.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
await threadPage.keyboard.type('About these replies.')
if ((await threadPage.evaluate(() => window.GALLERY_NAVIGATION.length)) !== threadNavigationBefore)
  throw new Error('Quoting a reply navigated away from the root draft')
const footerAfter = await threadComposer.boundingBox()
if (Math.abs(footerBefore.y + footerBefore.height - footerAfter.y - footerAfter.height) > 1)
  throw new Error('Thread composer did not stay at the bottom')
await threadComposer.getByRole('button', {name: 'Send reply'}).click()
await threadPage.waitForFunction(() => window.THREAD_SUBMISSIONS?.length === 2)
const threadSubmissions = await threadPage.evaluate(() => window.THREAD_SUBMISSIONS)
for (const submitted of threadSubmissions) {
  if (
    submitted.replyParent !== 'bafy-gallery-author/comment1' ||
    submitted.replyParentVersion !== 'c1' ||
    submitted.threadRootVersion !== 'c1'
  )
    throw new Error('A thread submission targeted a reply instead of the root')
}
const quotedContent = threadSubmissions[1].content.map((node) => node.block)
if (quotedContent[0].text !== 'Keep my draft.' || quotedContent.at(-1).text !== 'About these replies.')
  throw new Error('Quoting a reply replaced draft text or misplaced the cursor')
if (
  quotedContent
    .filter((block) => block.type === 'Embed')
    .map((block) => block.link)
    .join('|') !== 'hm://bafy-gallery-author/reply1?v=reply-version-1|hm://bafy-gallery-author/reply2?v=reply-version-2'
)
  throw new Error('Quoted replies lost their comment identities or versions')
await threadPage.getByText('About these replies.', {exact: true}).waitFor()
const threadText = await threadPage.locator('[data-slot="scroll-area-viewport"]').innerText()
if (
  threadText.lastIndexOf('About these replies.') < threadText.lastIndexOf('Direct reply to root.') ||
  threadText.lastIndexOf('Direct reply to root.') < threadText.lastIndexOf('Reply 7:')
)
  throw new Error('New comments did not appear at the end of the thread')
await threadPage.getByRole('button', {name: 'Back to comments'}).click()
await threadPage.screenshot({path: path.join(output, 'thread.png'), fullPage: true})
await threadPage.setViewportSize({width: 900, height: 800})
await threadPage.screenshot({path: path.join(output, 'thread-narrow.png'), fullPage: true})
await threadPage.close()
console.log(
  'Thread fixture: root-only posting, pinned reply embeds, draft retention, append order, focus, and fixed footer passed',
)
const referencePage = await browser.newPage({viewport: {width: 1000, height: 800}})
referencePage.on('pageerror', (error) => errors.push(error.message))
await referencePage.route('https://embed-review.test/**', (route) =>
  route.fulfill({contentType: 'text/html', body: '<html></html>'}),
)
await referencePage.goto('https://embed-review.test/reference#keep-this-location')
await referencePage.setContent('<html><body><div id="root"></div></body></html>')
await referencePage.evaluate(() => {
  window.REFERENCE_REVIEW = true
})
await referencePage.addStyleTag({content: css})
await referencePage.addScriptTag({content: js})
const initialReferenceUrl = referencePage.url()
const initialHistoryLength = await referencePage.evaluate(() => history.length)
await referencePage.getByRole('button', {name: 'Comment on block', exact: true}).click()
await referencePage.waitForFunction(() => document.querySelectorAll('.block-embed').length === 1)
await referencePage.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
await referencePage.keyboard.type('My added reply')
await referencePage.getByRole('button', {name: 'Comment on fragment', exact: true}).click()
await referencePage.waitForFunction(() => document.querySelectorAll('.block-embed').length === 2)
await referencePage.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
await referencePage.keyboard.type('After fragment')
await referencePage.getByRole('button', {name: 'Read submission'}).click()
await referencePage.waitForFunction(() => window.REFERENCE_SUBMISSION)
const submitted = await referencePage.evaluate(() => window.REFERENCE_SUBMISSION.blockNodes)
const submittedBlocks = submitted.map((node) => node.block)
if (submittedBlocks[0].text !== 'Keep my draft') throw new Error('Reference insertion overwrote the saved draft')
if (
  submittedBlocks
    .filter((block) => block.type === 'Embed')
    .map((block) => block.link)
    .join('|') !==
  'hm://bafy-gallery-author/field-notes?v=v1#intro|hm://bafy-gallery-author/field-notes?v=v1#intro[2:15]'
)
  throw new Error('Submission lost the block or fragment reference')
if (
  submittedBlocks.findIndex((block) => block.text === 'My added reply') >
  submittedBlocks.findIndex((block) => block.link?.endsWith('[2:15]'))
)
  throw new Error('Fragment was not appended after existing draft text')
if (submittedBlocks.filter((block) => block.text).at(-1).text !== 'After fragment')
  throw new Error('Focus was not below the appended embed')
if (
  referencePage.url() !== initialReferenceUrl ||
  (await referencePage.evaluate(() => history.length)) !== initialHistoryLength
)
  throw new Error('Reference insertion changed the document URL or history')
await referencePage.getByRole('button', {name: 'Close composer'}).click()
await referencePage.getByRole('button', {name: 'Comment on block', exact: true}).click()
await referencePage.waitForFunction(() => document.querySelectorAll('.block-embed').length === 3)
await referencePage.getByRole('button', {name: 'Switch reply target'}).click()
await referencePage.getByRole('button', {name: 'Comment on fragment', exact: true}).click()
await referencePage.waitForFunction(() => document.querySelectorAll('.block-embed').length === 4)
if ((await referencePage.getByTestId('reply-target').innerText()) !== 'bafy-gallery-author/comment1')
  throw new Error('Reference insertion changed the reply target')
await referencePage.waitForFunction(() => {
  const field = document.querySelector('.comment-editor')
  return field && field.scrollTop > 0 && document.activeElement?.classList.contains('ProseMirror')
})
if (referencePage.url() !== initialReferenceUrl || (await referencePage.evaluate(() => window.scrollY)) !== 0)
  throw new Error('Focusing the end of the draft moved the page or document reference')
await referencePage.screenshot({path: path.join(output, 'comment-references.png'), fullPage: true})
await referencePage.getByRole('button', {name: 'Close composer'}).click()
await referencePage.evaluate(() => {
  window.REFERENCE_DRAFT = []
})
await referencePage.getByRole('button', {name: 'Comment on block', exact: true}).click()
await referencePage.waitForFunction(() => document.querySelectorAll('.block-embed').length === 1)
await referencePage.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
await referencePage.getByRole('button', {name: 'Comment on block', exact: true}).click()
await referencePage.waitForFunction(() => document.querySelectorAll('.block-embed').length === 2)
await referencePage.getByRole('button', {name: 'Close composer'}).click()
await referencePage.evaluate(() => {
  window.REFERENCE_HYDRATION = true
  window.REFERENCE_DRAFT = [
    {block: {id: 'media-text', type: 'Paragraph', text: 'Keep media draft', attributes: {}}},
    {
      block: {
        id: 'saved-file',
        type: 'File',
        link: '',
        attributes: {name: 'saved.txt', mediaRef: JSON.stringify({draftId: 'review', mediaId: 'file1'})},
      },
    },
  ]
})
await referencePage.getByRole('button', {name: 'Comment on block', exact: true}).click()
await referencePage.waitForFunction(() => window.RESOLVE_REFERENCE_MEDIA)
if (await referencePage.locator('.block-embed').count())
  throw new Error('Reference inserted before saved media draft was restored')
await referencePage.getByRole('button', {name: 'Comment on fragment', exact: true}).click()
await referencePage.evaluate(() => window.RESOLVE_REFERENCE_MEDIA())
await referencePage.waitForFunction(() => document.querySelectorAll('.block-embed').length === 2)
await referencePage.getByText('Keep media draft', {exact: true}).waitFor()
if ((await referencePage.locator('[data-content-type="file"]').count()) !== 1)
  throw new Error('Reference insertion lost the saved attachment')
await referencePage.close()
console.log(
  'Comment references: append, focus, saved draft, remount, reply target, serialized content, and unchanged URL passed',
)
{
  const page = await browser.newPage({viewport: {width: 1280, height: 800}, reducedMotion: 'reduce'})
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://embed-review.test/**', (route) =>
    route.fulfill({contentType: 'text/html', body: '<html></html>'}),
  )
  await page.goto('https://embed-review.test/main-comments')
  await page.setContent('<html><body class="bg-background text-foreground"><div id="root"></div></body></html>')
  await page.evaluate(() => {
    window.DOCKED_COMMENTS_REVIEW = true
    window.THREAD_REVIEW = true
  })
  await page.addStyleTag({content: css})
  await page.addScriptTag({content: js})
  const footer = page.getByTestId('main-comments-footer')
  const composer = footer.getByTestId('thread-composer')
  await composer.waitFor()
  const scroll = page.getByTestId('main-comments-scroll')
  if (await scroll.getByTestId('thread-composer').count()) throw new Error('Composer is still in the scroll area')
  await page.getByText('Document header stays visible').waitFor()
  for (const width of [1280, 390]) {
    await page.setViewportSize({width, height: 800})
    const before = await footer.boundingBox()
    await scroll.evaluate(async (node) => {
      node.scrollTop = node.scrollHeight
      await new Promise(requestAnimationFrame)
    })
    const after = await footer.boundingBox()
    if (Math.abs(before.y - after.y) > 1 || Math.abs(after.y + after.height - 800) > 1)
      throw new Error('Footer moved with the document')
  }
  await composer.getByRole('button', {name: 'Write a Reply', exact: true}).click()
  await page.waitForFunction(() => document.activeElement?.classList.contains('ProseMirror'))
  await page.keyboard.type('Keep this draft while I quote a reply.')
  await page.getByRole('button', {name: 'Reply', exact: true}).first().click()
  await composer.locator('.block-embed').waitFor()
  if (!(await composer.innerText()).includes('Keep this draft')) throw new Error('Portal lost draft content')
  await composer.getByRole('button', {name: 'Send reply'}).click()
  await page.waitForFunction(() => window.THREAD_SUBMISSIONS?.length === 1)
  const submitted = await page.evaluate(() => window.THREAD_SUBMISSIONS[0])
  if (submitted.replyParent !== 'bafy-gallery-author/comment1') throw new Error('Posted reply to wrong target')
  await page
    .getByRole('link', {name: /Comments/})
    .locator('.lucide-arrow-up-right')
    .waitFor()
  await page.getByRole('link', {name: /Comments/}).click()
  const route = await page.evaluate(() => window.GALLERY_NAVIGATION.at(-1).route)
  if (
    route.key !== 'document' ||
    route.panel?.key !== 'comments' ||
    route.panel.openComment !== 'bafy-gallery-author/comment1'
  )
    throw new Error('Move-to-panel lost the thread')
  await page.screenshot({path: path.join(output, 'docked-comments.png')})
  await page.close()
}
console.log('Main Comments: docked composer, draft retention, root posting, and move-to-panel passed')

{
  const mobile = await browser.newPage({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true})
  mobile.on('pageerror', (error) => errors.push(error.message))
  await mobile.route('https://embed-review.test/**', (route) =>
    route.fulfill({contentType: 'text/html', body: '<html></html>'}),
  )
  await mobile.goto('https://embed-review.test/mobile')
  await mobile.setContent(
    '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body class="bg-background text-foreground"><div id="root"></div></body></html>',
  )
  await mobile.evaluate(() => {
    window.MOBILE_COMMENTS_REVIEW = true
    window.THREAD_REVIEW = true
  })
  await mobile.addStyleTag({content: css})
  await mobile.addScriptTag({content: js})
  const opener = mobile.getByRole('button', {name: 'Open mobile comments'})
  await opener.click()
  const sheet = mobile.getByRole('dialog')
  await sheet.waitFor()
  await mobile.waitForFunction(
    () =>
      document.querySelector('[data-slot="mobile-panel-sheet"]').getBoundingClientRect().top <
      window.innerHeight * 0.35 + 1,
  )
  const composer = sheet.getByTestId('thread-composer')
  const bounds = await composer.boundingBox()
  if (!bounds || bounds.y + bounds.height > 845) throw new Error('Mobile composer is clipped')
  await mobile.keyboard.press('Tab')
  if (!(await sheet.evaluate((node) => node.contains(document.activeElement))))
    throw new Error('Focus escaped the drawer')
  await mobile.getByRole('button', {name: 'Expand panel', exact: true}).click()
  await mobile.waitForFunction(
    () => document.querySelector('[data-slot="mobile-panel-sheet"]').getBoundingClientRect().top < 42,
  )
  await mobile.screenshot({path: path.join(output, 'mobile-comments.png')})
  await mobile.getByRole('button', {name: 'Close panel', exact: true}).click()
  await sheet.waitFor({state: 'detached'})
  await mobile.waitForFunction(() => document.activeElement?.textContent === 'Open mobile comments')
  if (await mobile.evaluate(() => document.body.style.position === 'fixed'))
    throw new Error('Body scroll stayed locked')
  await opener.click()
  await sheet.waitFor()
  await mobile.keyboard.press('Escape')
  await sheet.waitFor({state: 'detached'})
  await mobile.close()
}
console.log('Mobile drawer: composer visibility, resize, focus, animated close, Escape, and scroll restoration passed')

{
  const page = await browser.newPage({viewport: {width: 480, height: 900}, reducedMotion: 'reduce'})
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://embed-review.test/**', (route) =>
    route.fulfill({contentType: 'text/html', body: '<html></html>'}),
  )
  await page.goto('https://embed-review.test/connections')
  await page.setContent('<html><body class="bg-background text-foreground"><div id="root"></div></body></html>')
  await page.evaluate(() => {
    window.CONNECTIONS_REVIEW = true
  })
  await page.addStyleTag({content: css})
  await page.addScriptTag({content: js})
  const row = page.getByRole('button', {name: /Notes on shared context/})
  await row.waitFor()
  if ((await row.getAttribute('aria-expanded')) !== 'false') throw new Error('Connections did not start collapsed')
  if (await page.getByRole('link', {name: 'Go to location'}).count())
    throw new Error('Closed connection exposed source links')
  if (!(await row.textContent().then((text) => text.includes('3 links'))))
    throw new Error('Connection deduplication failed')
  for (const name of ['connections-header', 'attributes-header', 'activity-header']) {
    const height = await page
      .getByTestId(name)
      .locator(':scope > *')
      .first()
      .evaluate((node) => node.getBoundingClientRect().height)
    if (height !== 48) throw new Error(name + ' height is ' + height)
  }
  await row.click()
  await page.waitForFunction(() => document.querySelectorAll('a').length >= 3)
  const locations = page.getByRole('link', {name: 'Go to location'})
  if ((await locations.count()) !== 3) throw new Error('Missing source previews')
  await page.locator('[data-node-type="blockNode"]').first().waitFor()
  await page
    .getByText('The second paragraph remains visible when the complete resource is expanded.', {exact: true})
    .waitFor()
  if (await page.getByText('This source item is unavailable.', {exact: false}).count())
    throw new Error('Source preview failed')
  if (
    !(await locations
      .first()
      .getAttribute('href')
      .then((href) => href.includes('#intro')))
  )
    throw new Error('Source link lost block reference')
  await page.screenshot({path: path.join(output, 'connections.png'), fullPage: true})
  await row.click()
  if (await locations.count()) throw new Error('Collapsed source remains interactive')
  await page.close()
}
console.log(
  'Connections: grouped source documents, collapsed defaults, exact source blocks, location links, and 48px headers passed',
)

{
  const page = await browser.newPage({viewport: {width: 1280, height: 800}})
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('https://embed-review.test/**', (route) =>
    route.fulfill({contentType: 'text/html', body: '<html></html>'}),
  )
  await page.goto('https://embed-review.test/tools')
  await page.setContent(
    '<html><body class="bg-background text-foreground"><div id="root" style="width:320px"></div></body></html>',
  )
  await page.evaluate(() => {
    window.DOCUMENT_TOOLS_REVIEW = true
  })
  await page.addStyleTag({content: css})
  await page.addScriptTag({content: js})
  const comments = page.getByRole('link', {name: /Comments/})
  await comments.waitFor()
  await page.waitForFunction(() => document.querySelector('a[data-tab="document"] .sr-only'))
  const labelIsCollapsed = () =>
    comments.evaluate((link) =>
      [...link.querySelectorAll('span')].find((span) => span.textContent === 'Comments')?.classList.contains('sr-only'),
    )
  if (!(await labelIsCollapsed())) throw new Error('Wide viewport prevented container-based collapse')
  const people = page.getByRole('link', {name: /12 people/})
  if (
    !(await people
      .locator('span[aria-hidden="true"]')
      .last()
      .textContent()
      .then((text) => text === '12'))
  )
    throw new Error('People count disappeared when labels collapsed')
  await page.locator('#root').evaluate((node) => {
    node.style.width = '800px'
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('a[data-tab="document"]')].some(
      (link) =>
        !link.closest('[aria-hidden="true"]') &&
        [...link.querySelectorAll('span')].some(
          (span) => span.textContent === 'Comments' && !span.classList.contains('sr-only'),
        ),
    ),
  )
  await page.setViewportSize({width: 700, height: 800})
  await page.locator('#root').evaluate((node) => {
    node.style.width = '680px'
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('a[data-tab="document"]')].some(
      (link) =>
        !link.closest('[aria-hidden="true"]') &&
        [...link.querySelectorAll('span')].some(
          (span) => span.textContent === 'Comments' && !span.classList.contains('sr-only'),
        ),
    ),
  )
  if (await labelIsCollapsed()) throw new Error('Viewport media query still hides labels that fit')
  await page.locator('#root').evaluate((node) => {
    node.style.width = '320px'
  })
  await page.waitForFunction(() =>
    [...document.querySelectorAll('a[data-tab="document"]')].some(
      (link) => !link.closest('[aria-hidden="true"]') && link.querySelector('.sr-only'),
    ),
  )
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw new Error('Measurement row caused overflow')
  await page.close()
}
console.log('Document tools: labels follow container width, keep counts, and restore below the old viewport breakpoint')
await browser.close()
console.log(`Gallery artifacts: ${output}`)
if (errors.length) throw new Error(errors.join('\n'))
