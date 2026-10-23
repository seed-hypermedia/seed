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
const documentHostStyles = await textStyles()
await page.locator('main').evaluate((node) => node.classList.add('comment-editor', 'is-comment', 'hm-prose'))
const commentHostStyles = await textStyles()
if (JSON.stringify(documentHostStyles) !== JSON.stringify(commentHostStyles))
  throw new Error('Host comment styles changed embedded typography')
await page.locator('main').evaluate((node) => node.classList.remove('comment-editor', 'is-comment', 'hm-prose'))
await page.screenshot({path: path.join(output, 'wide-collapsed.png'), fullPage: true, animations: 'disabled'})
await page.setViewportSize({width: 390, height: 844})
await page.screenshot({path: path.join(output, 'narrow-collapsed.png'), fullPage: true, animations: 'disabled'})
await page.setViewportSize({width: 1280, height: 1000})
const expandButtons = page.getByRole('button', {name: /^Show full/})
if ((await expandButtons.count()) !== 3) throw new Error('Expected three fragment expansion controls')
for (let index = 0; index < 3; index++) await expandButtons.first().click()
if ((await page.getByRole('button', {name: /^Hide full/}).count()) !== 3) throw new Error('Fragments did not expand')
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
await browser.close()
console.log(`Gallery artifacts: ${output}`)
if (errors.length) throw new Error(errors.join('\n'))
