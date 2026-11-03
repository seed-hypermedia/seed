import {spawn, spawnSync, type ChildProcess} from 'node:child_process'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import {createServer, type Server} from 'node:http'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {
  chromium,
  _electron,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Locator,
  type Page,
  type Video,
} from 'playwright'
import {createPromiseClient} from '@connectrpc/connect'
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {commentRecordIdFromBlob, createComment, createSeedClient, unpackHmId} from '@seed-hypermedia/client'
import {createDocumentUpdate, type TestAccount} from '../../frontend/apps/cli/src/test/account-helpers'
import {FIXTURE_ACCOUNT, FIXTURE_ACCOUNT_ID} from '../../frontend/apps/cli/src/test/fixture-seed'
import {Daemon} from '../../frontend/packages/shared/src/client/.generated/daemon/v1alpha/daemon_connect'
import {createSignerFromKey} from '../../frontend/apps/cli/src/utils/signer'
import {
  FIXTURE_ACCOUNT_MNEMONIC,
  FIXTURE_DESIGN_INVENTORY_MARKDOWN,
  FIXTURE_DESIGN_INVENTORY_PATH,
  FIXTURE_DESIGN_INVENTORY_TITLE,
} from '../../test-fixtures/minimal-fixtures'
import {flattenToOperations, parseMarkdown} from '../../frontend/apps/cli/src/utils/markdown'
import {setupTestEnv, type TestEnv} from '../integration/test-env'
import {startVaultServer, type VaultServerInstance} from '../integration/vault-server'
import {defaultState, encodeHash} from '../../frontend/apps/design-playground/src/theme'
import {
  CAPTURE_THEMES,
  CAPTURE_VIEWPORTS,
  captureFileName,
  captureViews,
  createManifest,
  unionCaptureBounds,
  type CaptureBounds,
  type CaptureFailure,
  type CaptureManifest,
  type CaptureRecord,
  type CaptureTheme,
  type CaptureViewport,
} from './capture-utils'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const STORYBOOK_DIR = path.join(ROOT, 'frontend/packages/ui/storybook-static')
const PLAYGROUND_DIR = path.join(ROOT, 'frontend/apps/design-playground/dist')
const EMAIL_RENDERER = path.join(ROOT, 'frontend/apps/emails/render-all-previews.tsx')
const TEST_IMAGE = path.join(ROOT, 'test-fixtures/design-image.png')
const WEB_PORT = 59100
const DAEMON_HTTP_PORT = 59101
const DAEMON_GRPC_PORT = 59102
const DAEMON_P2P_PORT = 59103
const DESKTOP_P2P_PORT = 58100
const DESKTOP_DAEMON_HTTP_PORT = 58101
const DESKTOP_DAEMON_GRPC_PORT = 58102
const DESKTOP_API_PORT = 58104
const DESKTOP_AGENTS_PORT = 58105
const DESKTOP_LOCAL_SERVER_PORT = 58106
const VAULT_PORT = 59104
const STORYBOOK_PORT = 59200
const PLAYGROUND_PORT = 59201
const MASK_SELECTORS = ['.relative-time', '[data-relative-time]', 'time[data-relative]']
const STORY_PORTAL_SELECTORS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-radix-popper-content-wrapper]',
  '[data-sonner-toaster] li',
  '[vaul-drawer]',
]

type Options = {
  only: Set<string>
  out: string
  clips: boolean
  skipBuild: boolean
}

type Story = {
  id: string
  title: string
  name: string
  type: string
}

function parseOptions(args: string[]): Options {
  const knownSurfaces = ['storybook', 'playground', 'emails', 'web', 'vault', 'desktop']
  const onlyArg = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)
  const only = new Set(onlyArg ? onlyArg.split(',').filter(Boolean) : knownSurfaces)
  const unknown = [...only].filter((surface) => !knownSurfaces.includes(surface))
  if (unknown.length) throw new Error(`Unknown capture surface: ${unknown.join(', ')}`)

  const commit = execFile('git', ['rev-parse', 'HEAD'])
  const outArg = args.find((arg) => arg.startsWith('--out='))?.slice('--out='.length)
  const out = path.resolve(ROOT, outArg ?? `design-captures/${commit.slice(0, 7)}`)
  return {
    only,
    out,
    clips: args.includes('--clips'),
    skipBuild: args.includes('--skip-build'),
  }
}

function execFile(command: string, args: string[], cwd = ROOT): string {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8'})
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout.trim()
}

function runCommand(command: string, args: string[], cwd = ROOT): void {
  const result = spawnSync(command, args, {cwd, stdio: 'inherit'})
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`)
}

function addFailure(manifest: CaptureManifest, failure: CaptureFailure): void {
  manifest.failures.push(failure)
}

function addStartupFailure(manifest: CaptureManifest, surface: string, error: string): void {
  if (!manifest.failures.some((failure) => failure.surface === surface && failure.view === 'startup')) {
    addFailure(manifest, {surface, view: 'startup', error})
  }
}

function ensureSurface(manifest: CaptureManifest, surface: string): CaptureRecord[] {
  manifest.surfaces[surface] ??= []
  return manifest.surfaces[surface]
}

async function settlePage(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', {timeout: 15000}).catch(() => {})
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  await page.addStyleTag({content: '*{caret-color:transparent!important}'})
}

async function newContext(browser: Browser, theme: CaptureTheme, viewport: CaptureViewport): Promise<BrowserContext> {
  return browser.newContext({
    viewport: CAPTURE_VIEWPORTS[viewport],
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: theme,
    reducedMotion: 'reduce',
  })
}

async function capturePage(
  manifest: CaptureManifest,
  outDir: string,
  surface: string,
  view: string,
  theme: CaptureTheme,
  viewport: CaptureViewport,
  page: Page,
  fullPage = true,
  url = page.url(),
): Promise<void> {
  const relativeFile = captureFileName(surface, view, theme, viewport)
  const file = path.join(outDir, relativeFile)
  mkdirSync(path.dirname(file), {recursive: true})
  try {
    await settlePage(page)
    await page.screenshot({
      path: file,
      fullPage,
      animations: 'disabled',
      mask: MASK_SELECTORS.map((selector) => page.locator(selector)),
    })
    ensureSurface(manifest, surface).push({view, theme, viewport, file: relativeFile, url})
  } catch (error) {
    rmSync(file, {force: true})
    addFailure(manifest, {surface, view, theme, viewport, error: errorMessage(error)})
  }
}

async function captureStoryContent(
  manifest: CaptureManifest,
  outDir: string,
  view: string,
  theme: CaptureTheme,
  page: Page,
  fullscreen: boolean,
  url: string,
): Promise<void> {
  const relativeFile = captureFileName('storybook', view, theme, 'desktop')
  const file = path.join(outDir, relativeFile)
  mkdirSync(path.dirname(file), {recursive: true})
  try {
    await settlePage(page)
    const viewport = await page.evaluate((portalSelectors) => {
      const visible = (element: Element) => {
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity) > 0
        )
      }
      const getBounds = (element: Element): CaptureBounds => {
        const bounds = element.getBoundingClientRect()
        return {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height}
      }
      const contentBounds = (element: Element): CaptureBounds[] => {
        const bounds = getBounds(element)
        const children = Array.from(element.children).filter(visible)
        if (children.length && (bounds.width >= window.innerWidth * 0.9 || bounds.height >= window.innerHeight * 0.9)) {
          return children.flatMap(contentBounds)
        }
        return [bounds]
      }
      const root = document.querySelector('#storybook-root')
      const rootBounds = root ? Array.from(root.children).filter(visible).flatMap(contentBounds) : []
      const portalBounds = portalSelectors.flatMap((selector) =>
        Array.from(document.querySelectorAll(selector)).filter(visible).map(getBounds),
      )
      return {width: window.innerWidth, height: window.innerHeight, bounds: [...rootBounds, ...portalBounds]}
    }, STORY_PORTAL_SELECTORS)
    const clip = fullscreen
      ? undefined
      : unionCaptureBounds(viewport.bounds, {width: viewport.width, height: viewport.height}, 24)
    if (!fullscreen && !clip) throw new Error('empty render')
    await page.screenshot({
      path: file,
      ...(clip ? {clip} : {}),
      fullPage: false,
      animations: 'disabled',
      mask: MASK_SELECTORS.map((selector) => page.locator(selector)),
    })
    ensureSurface(manifest, 'storybook').push({
      view,
      theme,
      viewport: 'desktop',
      file: relativeFile,
      url,
    })
  } catch (error) {
    rmSync(file, {force: true})
    addFailure(manifest, {surface: 'storybook', view, theme, viewport: 'desktop', error: errorMessage(error)})
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function withPage(
  browser: Browser,
  theme: CaptureTheme,
  viewport: CaptureViewport,
  callback: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await newContext(browser, theme, viewport)
  try {
    const page = await context.newPage()
    await callback(page)
  } finally {
    await context.close()
  }
}

async function startStaticServer(directory: string, port: number): Promise<Server> {
  const root = path.resolve(directory)
  const contentTypes: Record<string, string> = {
    '.css': 'text/css',
    '.html': 'text/html',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.gif': 'image/gif',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', `http://localhost:${port}`).pathname)
    let target = path.resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1))
    if (!target.startsWith(`${root}${path.sep}`) && target !== root) {
      response.writeHead(403).end()
      return
    }
    if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'index.html')
    if (!existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404).end('Not found')
      return
    }
    response.setHeader('Content-Type', contentTypes[path.extname(target)] ?? 'application/octet-stream')
    createReadStream(target).pipe(response)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  return server
}

async function readStories(): Promise<Story[]> {
  const index = JSON.parse(readFileSync(path.join(STORYBOOK_DIR, 'index.json'), 'utf8')) as {
    entries: Record<string, Story>
  }
  return Object.values(index.entries).filter((entry) => entry.type === 'story')
}

async function captureStorybook(browser: Browser, manifest: CaptureManifest, options: Options): Promise<void> {
  let stories: Story[]
  try {
    stories = await readStories()
  } catch (error) {
    addFailure(manifest, {surface: 'storybook', view: 'index', error: errorMessage(error)})
    return
  }
  let server: Server | undefined
  try {
    server = await startStaticServer(STORYBOOK_DIR, STORYBOOK_PORT)
    for (const story of stories) {
      for (const theme of CAPTURE_THEMES) {
        await withPage(browser, theme, 'desktop', async (page) => {
          const url = new URL('/iframe.html', `http://127.0.0.1:${STORYBOOK_PORT}`)
          url.searchParams.set('id', story.id)
          url.searchParams.set('viewMode', 'story')
          url.searchParams.set('globals', `theme:${theme}`)
          await page.goto(url.toString(), {waitUntil: 'domcontentloaded'})
          const ready = await page
            .waitForFunction(
              (portalSelectors) => {
                const visible = (element: Element) => {
                  const bounds = element.getBoundingClientRect()
                  const style = getComputedStyle(element)
                  return (
                    bounds.width > 0 &&
                    bounds.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    Number(style.opacity) > 0
                  )
                }
                const root = document.querySelector('#storybook-root')
                return (
                  Boolean(root?.children.length) ||
                  portalSelectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(visible))
                )
              },
              STORY_PORTAL_SELECTORS,
              {timeout: 10000},
            )
            .then(() => true)
            .catch(() => false)
          if (!ready) {
            const storyError = await page.evaluate(() =>
              Array.from(document.querySelectorAll('#error-message, .sb-errordisplay'))
                .map((element) => element.textContent?.trim())
                .filter(Boolean)
                .join('\n'),
            )
            addFailure(manifest, {
              surface: 'storybook',
              view: story.id,
              theme,
              viewport: 'desktop',
              error: storyError || 'empty render',
            })
            return
          }
          const layout = await page.evaluate(async (storyId) => {
            const preview = (window as typeof window & {__STORYBOOK_PREVIEW__?: any}).__STORYBOOK_PREVIEW__
            try {
              const store = preview?.storyStoreValue
              const story = await store?.loadStory({storyId})
              const context = story ? await store?.getStoryContext?.(story) : undefined
              return context?.parameters?.layout || story?.parameters?.layout
            } catch {
              return undefined
            }
          }, story.id)
          await captureStoryContent(
            manifest,
            options.out,
            story.id,
            theme,
            page,
            layout === 'fullscreen',
            url.toString(),
          )
        }).catch((error) =>
          addFailure(manifest, {
            surface: 'storybook',
            view: story.id,
            theme,
            viewport: 'desktop',
            error: errorMessage(error),
          }),
        )
      }
    }
    if (options.clips) await captureStoryClips(browser, stories, manifest, options.out)
  } catch (error) {
    addFailure(manifest, {surface: 'storybook', view: 'server', error: errorMessage(error)})
  } finally {
    await closeServer(server)
  }
}

const CLIP_STORIES: Record<string, {pattern: RegExp; mobile?: boolean; trigger: RegExp}> = {
  dropdown: {pattern: /dropdown|menu/i, trigger: /open|menu|select/i},
  dialog: {pattern: /dialog|alertdialog/i, trigger: /open|dialog|show/i},
  popover: {pattern: /popover/i, trigger: /open|popover/i},
  tooltip: {pattern: /tooltip/i, trigger: /button|hover|tooltip/i},
  toast: {pattern: /toast|notification/i, trigger: /show|toast|notify/i},
  'mobile-drawer': {pattern: /drawer|sheet/i, mobile: true, trigger: /open|menu|drawer|sheet/i},
  'button-press': {pattern: /button/i, trigger: /button|default|primary/i},
  'sidebar-collapse': {pattern: /sidebar/i, trigger: /collapse|sidebar|menu/i},
}

async function captureStoryClips(
  browser: Browser,
  stories: Story[],
  manifest: CaptureManifest,
  outDir: string,
): Promise<void> {
  const clipsDir = path.join(outDir, 'clips')
  const tempDir = mkdtempSync(path.join(tmpdir(), 'seed-story-clips-'))
  mkdirSync(clipsDir, {recursive: true})
  try {
    for (const [clipName, config] of Object.entries(CLIP_STORIES)) {
      const story = stories.find((candidate) =>
        config.pattern.test(`${candidate.title} ${candidate.name} ${candidate.id}`),
      )
      if (!story) continue
      const viewportName = config.mobile ? 'mobile' : 'desktop'
      const viewport = CAPTURE_VIEWPORTS[viewportName]
      const context = await browser.newContext({
        viewport,
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'UTC',
        colorScheme: 'light',
        reducedMotion: 'no-preference',
        recordVideo: {dir: tempDir, size: viewport},
      })
      let video: Video | undefined
      try {
        const page = await context.newPage()
        const url = new URL('/iframe.html', `http://127.0.0.1:${STORYBOOK_PORT}`)
        url.searchParams.set('id', story.id)
        url.searchParams.set('viewMode', 'story')
        url.searchParams.set('globals', 'theme:light')
        await page.goto(url.toString(), {waitUntil: 'domcontentloaded'})
        await page.locator('#storybook-root').waitFor({state: 'visible', timeout: 20000})
        const trigger = page.getByRole('button', {name: config.trigger}).first()
        if (await trigger.count()) {
          if (clipName === 'tooltip') await trigger.hover()
          else if (clipName === 'button-press') await trigger.dispatchEvent('pointerdown')
          else await trigger.click()
        }
        video = page.video() ?? undefined
        await page.waitForTimeout(3000)
        await context.close()
        if (video) {
          const finalPath = path.join(clipsDir, `${clipName}--light.webm`)
          renameSync(await video.path(), finalPath)
        }
      } catch (error) {
        addFailure(manifest, {
          surface: 'storybook',
          view: `clip:${clipName}`,
          theme: 'light',
          viewport: viewportName,
          error: errorMessage(error),
        })
        await context.close().catch(() => {})
      }
    }
  } finally {
    rmSync(tempDir, {recursive: true, force: true})
  }
}

async function capturePlayground(browser: Browser, manifest: CaptureManifest, options: Options): Promise<void> {
  let server: Server | undefined
  try {
    server = await startStaticServer(PLAYGROUND_DIR, PLAYGROUND_PORT)
    for (const theme of CAPTURE_THEMES) {
      for (const viewport of Object.keys(CAPTURE_VIEWPORTS) as CaptureViewport[]) {
        await withPage(browser, theme, viewport, async (page) => {
          const state = defaultState()
          state.mode = theme
          const url = new URL(`http://127.0.0.1:${PLAYGROUND_PORT}`)
          url.hash = encodeHash(state)
          await page.goto(url.toString(), {waitUntil: 'domcontentloaded'})
          const compositions = page.locator('#compositions article.composition')
          await compositions.first().waitFor({state: 'visible', timeout: 20000})
          const count = await compositions.count()
          for (let index = 0; index < count; index++) {
            const composition = compositions.nth(index)
            const view = (await composition.locator('h3').innerText()).trim()
            await captureElement(manifest, options.out, 'playground', view, theme, viewport, page, composition)
          }
        }).catch((error) =>
          addFailure(manifest, {
            surface: 'playground',
            view: 'compositions',
            theme,
            viewport,
            error: errorMessage(error),
          }),
        )
      }
    }
  } catch (error) {
    addFailure(manifest, {surface: 'playground', view: 'server', error: errorMessage(error)})
  } finally {
    await closeServer(server)
  }
}

async function captureElement(
  manifest: CaptureManifest,
  outDir: string,
  surface: string,
  view: string,
  theme: CaptureTheme,
  viewport: CaptureViewport,
  page: Page,
  element: Locator,
): Promise<void> {
  const relativeFile = captureFileName(surface, view, theme, viewport)
  const file = path.join(outDir, relativeFile)
  mkdirSync(path.dirname(file), {recursive: true})
  try {
    await settlePage(page)
    await element.scrollIntoViewIfNeeded()
    await element.screenshot({path: file, animations: 'disabled'})
    ensureSurface(manifest, surface).push({view, theme, viewport, file: relativeFile, url: page.url()})
  } catch (error) {
    rmSync(file, {force: true})
    addFailure(manifest, {surface, view, theme, viewport, error: errorMessage(error)})
  }
}

async function captureEmails(browser: Browser, manifest: CaptureManifest, options: Options): Promise<void> {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'seed-email-previews-'))
  try {
    runCommand('bun', [EMAIL_RENDERER], tempDir)
    const previewsDir = path.join(tempDir, 'email-previews')
    for (const view of captureViews('emails')) {
      const file = path.join(previewsDir, `${view}.html`)
      if (!existsSync(file)) {
        addFailure(manifest, {surface: 'emails', view, theme: 'light', error: `Missing preview file: ${file}`})
        continue
      }
      const url = `file://${file}`
      for (const viewport of Object.keys(CAPTURE_VIEWPORTS) as CaptureViewport[]) {
        await withPage(browser, 'light', viewport, async (page) => {
          await page.goto(url, {waitUntil: 'domcontentloaded'})
          await page.locator('body').waitFor({state: 'visible'})
          await capturePage(manifest, options.out, 'emails', view, 'light', viewport, page, true, url)
        }).catch((error) =>
          addFailure(manifest, {surface: 'emails', view, theme: 'light', viewport, error: errorMessage(error)}),
        )
      }
    }
  } catch (error) {
    for (const view of captureViews('emails')) {
      addFailure(manifest, {surface: 'emails', view, theme: 'light', error: errorMessage(error)})
    }
  } finally {
    rmSync(tempDir, {recursive: true, force: true})
  }
}

async function seedDesignInventory(serverUrl: string, account: TestAccount): Promise<void> {
  const referenceOps = [
    {type: 'SetAttributes' as const, attrs: [{key: ['name'], value: 'Design reference'}]},
    {
      type: 'ReplaceBlock' as const,
      block: {
        id: 'reference-intro',
        type: 'Paragraph',
        text: 'A compact reference for the visual language used throughout this baseline.',
        annotations: [],
        link: '',
      },
    },
    {type: 'MoveBlocks' as const, blocks: ['reference-intro'], parent: ''},
  ]
  await createDocumentUpdate(serverUrl, account, 'design/reference', referenceOps)

  const notesOps = [
    {type: 'SetAttributes' as const, attrs: [{key: ['name'], value: 'Design notes'}]},
    {
      type: 'ReplaceBlock' as const,
      block: {
        id: 'notes-query',
        type: 'Query',
        text: '',
        annotations: [],
        link: '',
        query: {
          includes: [{space: '', path: '', mode: 'Children'}],
          sort: [{term: 'UpdateTime', reverse: false}],
        },
        style: 'Table',
        columnCount: 3,
        banner: false,
      },
    },
    {type: 'MoveBlocks' as const, blocks: ['notes-query'], parent: ''},
  ]
  await createDocumentUpdate(serverUrl, account, 'design/notes', notesOps)

  const notes = [
    ['01-hierarchy', 'A useful hierarchy', 'Start with a clear title, a useful summary, and one obvious next step.'],
    ['02-color', 'Color with intent', 'Use semantic color tokens and verify contrast in light and dark themes.'],
    [
      '03-motion',
      'Motion with purpose',
      'Keep movement brief, reversible, and respectful of reduced-motion preferences.',
    ],
    [
      '04-responsive',
      'Responsive by default',
      'Let content reflow naturally before adding breakpoint-specific exceptions.',
    ],
  ]
  for (const [slug, name, text] of notes) {
    const blockId = `note-${slug}`
    await createDocumentUpdate(serverUrl, account, `design/notes/${slug}`, [
      {
        type: 'SetAttributes',
        attrs: [
          {key: ['name'], value: name},
          {key: ['summary'], value: text},
        ],
      },
      {
        type: 'ReplaceBlock',
        block: {id: blockId, type: 'Paragraph', text, annotations: [], link: ''},
      },
      {type: 'MoveBlocks', blocks: [blockId], parent: ''},
    ])
  }

  const image = `data:image/png;base64,${readFileSync(TEST_IMAGE).toString('base64')}`
  const markdown = FIXTURE_DESIGN_INVENTORY_MARKDOWN.replaceAll('{{ACCOUNT_ID}}', FIXTURE_ACCOUNT_ID).replace(
    './design-image.png',
    image,
  )
  const {tree} = parseMarkdown(markdown)
  const articleOps = [
    {
      type: 'SetAttributes' as const,
      attrs: [
        {key: ['name'], value: FIXTURE_DESIGN_INVENTORY_TITLE},
        {
          key: ['summary'],
          value: 'A field guide to content structure, shared patterns, and visual consistency.',
        },
      ],
    },
    ...flattenToOperations(tree),
  ]
  await createDocumentUpdate(serverUrl, account, FIXTURE_DESIGN_INVENTORY_PATH, articleOps)
}

async function seedDesignComments(serverUrl: string, account: TestAccount): Promise<void> {
  const target = `hm://${account.accountId}/design/article`
  const docId = unpackHmId(target)
  if (!docId) throw new Error('Design article URL could not be parsed')
  const client = createSeedClient(serverUrl)
  const resource = await client.request('Resource', docId)
  if (resource.type !== 'document' || !resource.document.version) {
    throw new Error('Design article was not available for comment seeding')
  }
  const signer = createSignerFromKey(account.keyPair)
  const publish = async (text: string, replyTo?: string): Promise<string> => {
    const comment = await createComment(
      {
        content: [
          {block: {id: `comment-${Date.now()}`, type: 'Paragraph', text, annotations: []}, children: []},
        ] as any,
        docId,
        docVersion: resource.document.version,
        blobs: [],
        replyCommentVersion: replyTo,
        rootReplyCommentVersion: replyTo,
      } as any,
      signer,
    )
    const blob = comment.blobs[0]?.data
    if (!blob) throw new Error('Comment has no publishable blob')
    const commentId = await commentRecordIdFromBlob(blob)
    await client.publish(comment)
    return commentId
  }
  const firstCommentId = await publish('A clear visual hierarchy makes this article easy to scan.')
  const firstComment = await client.request('Comment', firstCommentId)
  const firstCommentVersion = firstComment.version || firstComment.id
  if (!firstCommentVersion) throw new Error('First design comment has no version')
  await publish('The light and dark examples are both helpful.', firstCommentVersion)
  await publish('The spacing between sections feels consistent.')
}

async function setCollectionStyle(serverUrl: string, style: 'Table' | 'List' | 'Cards'): Promise<void> {
  await createDocumentUpdate(serverUrl, FIXTURE_ACCOUNT, 'design/notes', [
    {
      type: 'ReplaceBlock',
      block: {
        id: 'notes-query',
        type: 'Query',
        text: '',
        annotations: [],
        link: '',
        query: {
          includes: [{space: '', path: '', mode: 'Children'}],
          sort: [{term: 'UpdateTime', reverse: false}],
        },
        style,
        columnCount: 3,
        banner: false,
      },
    },
    {type: 'MoveBlocks', blocks: ['notes-query'], parent: ''},
  ])
}

async function openWebView(page: Page, baseUrl: string, view: string): Promise<string> {
  const paths: Record<string, string> = {
    home: '/',
    article: '/design/article',
    'article-discussion': '/design/article/:comments',
    'notes-table': '/design/notes',
    'notes-list': '/design/notes',
    'notes-cards': '/design/notes',
    'not-found': '/design/this-page-does-not-exist',
  }
  const url = new URL(paths[view], baseUrl)
  await page.goto(url.toString(), {waitUntil: 'domcontentloaded'})
  await page.locator('body').waitFor({state: 'visible', timeout: 20000})
  if (view === 'article') {
    await page.getByText('A shared visual language', {exact: true}).waitFor({state: 'visible', timeout: 15000})
  } else if (view === 'article-discussion') {
    await page
      .getByText(/discussion|comments/i)
      .first()
      .waitFor({state: 'visible', timeout: 15000})
  } else if (view.startsWith('notes-')) {
    await page.getByText('Design notes', {exact: true}).first().waitFor({state: 'visible', timeout: 15000})
  } else if (view === 'not-found') {
    await page
      .getByText(/not found|doesn.t exist|not published/i)
      .first()
      .waitFor({state: 'visible', timeout: 15000})
  }
  return url.toString()
}

async function captureWeb(browser: Browser, manifest: CaptureManifest, options: Options, env: TestEnv): Promise<void> {
  let commentSeedError: string | undefined
  try {
    await seedDesignComments(env.web.baseUrl, FIXTURE_ACCOUNT)
  } catch (error) {
    commentSeedError = errorMessage(error)
  }
  let fontRecorded = false
  for (const theme of CAPTURE_THEMES) {
    for (const viewport of Object.keys(CAPTURE_VIEWPORTS) as CaptureViewport[]) {
      for (const view of captureViews('web')) {
        await withPage(browser, theme, viewport, async (page) => {
          if (view === 'article-discussion' && commentSeedError) {
            throw new Error(`Comment fixture seeding failed: ${commentSeedError}`)
          }
          const url = await openWebView(page, env.web.baseUrl, view)
          if (!fontRecorded && view === 'home' && viewport === 'desktop') {
            await recordWebFont(manifest, page)
            fontRecorded = true
          }
          if (view.startsWith('notes-')) {
            const styleName = view === 'notes-list' ? 'List' : view === 'notes-cards' ? 'Cards' : 'Table'
            const viewButton = page.getByRole('button', {name: new RegExp(`^${styleName}$`, 'i')}).first()
            if (await viewButton.count()) {
              await viewButton.click()
            } else {
              await setCollectionStyle(env.web.baseUrl, styleName)
              await page.reload({waitUntil: 'domcontentloaded'})
            }
          }
          await capturePage(manifest, options.out, 'web', view, theme, viewport, page, true, url)
        }).catch((error) => addFailure(manifest, {surface: 'web', view, theme, viewport, error: errorMessage(error)}))
      }
    }
  }
}

async function recordWebFont(manifest: CaptureManifest, page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  const font = await page.evaluate(() => {
    const computedFontFamily = getComputedStyle(document.body).fontFamily
    const firstFamily = computedFontFamily
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '')
    const loadedFace = Array.from(document.fonts)
      .find((face) => face.status === 'loaded' && face.family.replace(/^['"]|['"]$/g, '') === firstFamily)
      ?.family.replace(/^['"]|['"]$/g, '')
    return {computedFontFamily, firstFamily, loadedFace}
  })
  const matched = spawnSync('fc-match', ['-f', '%{family[0]}', font.firstFamily], {encoding: 'utf8'})
  manifest.fonts.web = {
    computedFontFamily: font.computedFontFamily,
    renderedFace: font.loadedFace || (matched.status === 0 ? matched.stdout.trim() : font.firstFamily),
  }
}

async function captureVault(
  browser: Browser,
  manifest: CaptureManifest,
  options: Options,
  env: TestEnv,
): Promise<void> {
  let vault: VaultServerInstance | undefined
  let currentView = 'first-screen'
  try {
    vault = await startVaultServer({
      port: VAULT_PORT,
      backendHttpPort: env.daemon.config.httpPort,
      webBaseUrl: env.web.baseUrl,
    })
    await vault.waitForReady()
    const context = await browser.newContext({
      viewport: CAPTURE_VIEWPORTS.desktop,
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    })
    try {
      const page = await context.newPage()
      await page.goto(vault.vaultUrl, {waitUntil: 'domcontentloaded'})
      await page.locator('body').waitFor({state: 'visible', timeout: 20000})
      await captureVaultVariants(manifest, options.out, page, 'first-screen', vault.vaultUrl)

      currentView = 'verification-code'
      const email = `design-baseline-${Date.now()}@example.com`
      const password = 'Design-Baseline-Password-7319!'
      const emailField = page.getByLabel(/email/i).first()
      await emailField.fill(email)
      await page.getByRole('button', {name: 'Send code'}).click()
      await page.getByText('Check your inbox').waitFor({state: 'visible', timeout: 15000})
      await captureVaultVariants(manifest, options.out, page, 'verification-code', page.url())
      const code = await vault.waitForVerificationCode(email, 30000)
      await enterVaultVerificationCode(page, code)
      await page.getByText('Use a password', {exact: true}).waitFor({state: 'visible', timeout: 30000})
      currentView = 'auth-choice'
      await captureVaultVariants(manifest, options.out, page, 'auth-choice', page.url())
      await page.getByText('Use a password', {exact: true}).click()

      currentView = 'signup-password'
      await page.getByText('Create a password', {exact: true}).waitFor({state: 'visible', timeout: 15000})
      await captureVaultVariants(manifest, options.out, page, 'signup-password', page.url())
      await page.getByRole('textbox', {name: 'Password', exact: true}).fill(password)
      await page.getByLabel('Confirm password').fill(password)
      await page.getByRole('button', {name: 'Continue'}).click()

      currentView = 'recovery-words'
      await page.getByText('Save your recovery words', {exact: true}).waitFor({state: 'visible', timeout: 30000})
      await captureVaultVariants(manifest, options.out, page, 'recovery-words', page.url())
      await page.getByRole('button', {name: "I've saved my words"}).click()
      await page.getByText('Your identity is secured', {exact: true}).waitFor({state: 'visible', timeout: 20000})
      await page.getByRole('button', {name: 'Continue'}).click()
      await page.getByText(/create your profile/i).waitFor({state: 'visible', timeout: 20000})
      currentView = 'signed-in'
      await captureVaultVariants(manifest, options.out, page, 'signed-in', page.url())
      await page.evaluate(async () => {
        await fetch('/api/logout', {method: 'POST'})
      })
      await page.goto(`${vault.vaultUrl.replace(/\/+$/, '')}/login`, {waitUntil: 'domcontentloaded'})

      currentView = 'sign-in'
      await page.locator('body').waitFor({state: 'visible', timeout: 20000})
      console.log(`[Vault sign-in DOM] ${await page.locator('body').innerText()}`)
      await captureVaultVariants(manifest, options.out, page, 'sign-in', page.url())
      await page.getByRole('button', {name: 'Sign in with password'}).waitFor({state: 'visible', timeout: 30000})
      await page.getByRole('button', {name: 'Sign in with password'}).click()
      await page.getByText('Sign in with password', {exact: true}).waitFor({state: 'visible', timeout: 15000})
      await page.getByRole('textbox', {name: 'Password', exact: true}).fill(password)
      await page.getByRole('button', {name: 'Continue'}).click()
      await page.getByText(/create your profile/i).waitFor({state: 'visible', timeout: 30000})
      currentView = 'signed-in'
      await captureVaultVariants(manifest, options.out, page, 'signed-in', page.url())
    } finally {
      await context.close()
    }
  } catch (error) {
    addFailure(manifest, {surface: 'vault', view: currentView, error: errorMessage(error)})
  } finally {
    await vault?.kill()
  }
}

async function enterVaultVerificationCode(page: Page, code: string): Promise<void> {
  const codeInputs = page.locator('input[inputmode="numeric"]')
  const inputCount = await codeInputs.count()
  if (inputCount !== code.length) {
    throw new Error(`Expected ${code.length} verification code inputs, found ${inputCount}`)
  }
  for (const [index, digit] of Array.from(code).entries()) {
    await codeInputs.nth(index).fill(digit)
  }
}

async function captureVaultVariants(
  manifest: CaptureManifest,
  outDir: string,
  page: Page,
  view: string,
  url: string,
): Promise<void> {
  for (const theme of CAPTURE_THEMES) {
    await page.emulateMedia({colorScheme: theme, reducedMotion: 'reduce'})
    for (const viewport of Object.keys(CAPTURE_VIEWPORTS) as CaptureViewport[]) {
      await page.setViewportSize(CAPTURE_VIEWPORTS[viewport])
      await capturePage(manifest, outDir, 'vault', view, theme, viewport, page, true, url)
    }
  }
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${url}: ${errorMessage(lastError)}`)
}

async function setDesktopTheme(page: Page, theme: CaptureTheme): Promise<void> {
  const themeRadio = (candidate: Page) => candidate.getByRole('radio', {name: new RegExp(`^${theme}$`, 'i')}).first()
  let settingsPage: Page | undefined
  for (const candidate of page.context().pages()) {
    if (await themeRadio(candidate).count()) {
      settingsPage = candidate
      break
    }
  }
  if (!settingsPage) {
    await page.keyboard.press('Control+,')
    const deadline = Date.now() + 15000
    while (!settingsPage && Date.now() < deadline) {
      for (const candidate of page.context().pages()) {
        if (await themeRadio(candidate).count()) {
          settingsPage = candidate
          break
        }
      }
      if (!settingsPage) await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (!settingsPage) throw new Error('App Settings did not open from the native Settings shortcut')
  const radio = themeRadio(settingsPage)
  await radio.waitFor({state: 'visible', timeout: 10000})
  await radio.check()
  await page.waitForFunction(
    (expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'),
    theme,
    {timeout: 10000},
  )
}

async function openDesktopArticle(page: Page): Promise<void> {
  const onboardingUrlButton = page.getByRole('button', {name: 'Input a Space URL'})
  if (await onboardingUrlButton.isVisible().catch(() => false)) {
    await onboardingUrlButton.click()
  } else {
    await page.keyboard.press('Control+l')
  }
  const address = page.locator('input[placeholder*="paste a URL"]')
  await address.waitFor({state: 'visible', timeout: 10000})
  await address.fill(`hm://${FIXTURE_ACCOUNT_ID}/${FIXTURE_DESIGN_INVENTORY_PATH}`)
  await address.press('Enter')
  await page.getByText('A shared visual language', {exact: true}).waitFor({state: 'visible', timeout: 15000})
}

async function captureDesktopView(
  page: Page,
  manifest: CaptureManifest,
  options: Options,
  view: string,
  theme: CaptureTheme,
  setup: () => Promise<void>,
): Promise<void> {
  try {
    await setDesktopTheme(page, theme)
    await setup()
    await capturePage(manifest, options.out, 'desktop', view, theme, 'desktop', page, true)
  } catch (error) {
    addFailure(manifest, {surface: 'desktop', view, theme, viewport: 'desktop', error: errorMessage(error)})
  }
}

async function captureDesktop(manifest: CaptureManifest, options: Options, env?: TestEnv): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'seed-design-desktop-'))
  const startupLog = path.join(options.out, 'desktop-startup.log')
  const rendererServers: ChildProcess[] = []
  let electronApp: ElectronApplication | undefined
  let currentView = 'startup'
  try {
    writeFileSync(startupLog, '')
    const desktopEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) =>
          !/^(DAEMON_|VITE_DESKTOP_|SEED_(HTTP|GRPC|P2P)_PORT$|SEED_NO_DAEMON_SPAWN$|DESKTOP_API_HTTP_URL$)/.test(key),
      ),
    ) as NodeJS.ProcessEnv
    const desktopDaemonHttpPort = DESKTOP_DAEMON_HTTP_PORT
    const desktopDaemonGrpcPort = DESKTOP_DAEMON_GRPC_PORT
    const desktopDaemonP2pPort = DESKTOP_P2P_PORT
    Object.assign(desktopEnv, {
      DISPLAY: ':0',
      SEED_FIXTURE_DATA_DIR: dataDir,
      DAEMON_HTTP_PORT: String(desktopDaemonHttpPort),
      DAEMON_GRPC_PORT: String(desktopDaemonGrpcPort),
      DAEMON_P2P_PORT: String(desktopDaemonP2pPort),
      VITE_DESKTOP_P2P_PORT: String(desktopDaemonP2pPort),
      VITE_DESKTOP_HTTP_PORT: String(desktopDaemonHttpPort),
      VITE_DESKTOP_GRPC_PORT: String(desktopDaemonGrpcPort),
      VITE_DESKTOP_API_PORT: String(DESKTOP_API_PORT),
      VITE_DESKTOP_HOSTNAME: 'http://127.0.0.1',
      VITE_DESKTOP_DEFAULT_AGENTS_URL: `http://127.0.0.1:${DESKTOP_AGENTS_PORT}`,
      VITE_DESKTOP_APPDATA: `Seed-design-baseline-${path.basename(dataDir)}`,
      XDG_CONFIG_HOME: path.join(dataDir, 'config'),
      SEED_LOCAL_SERVER_PORT: String(DESKTOP_LOCAL_SERVER_PORT),
      NODE_ENV: 'development',
    })
    if (env) desktopEnv.SEED_NO_DAEMON_SPAWN = '1'
    if (env?.web.baseUrl) {
      desktopEnv.VITE_GATEWAY_URL = env.web.baseUrl
      desktopEnv.VITE_SEED_HOST_URL = env.web.baseUrl
    }
    const rendererConfigs: ReadonlyArray<[string, number]> = [['vite.renderer.config.mts', 5173]]
    for (const [config, port] of rendererConfigs) {
      const desktopDirectory = path.join(ROOT, 'frontend/apps/desktop')
      const renderer = spawn(
        'node',
        [
          path.join(desktopDirectory, 'node_modules/vite/bin/vite.js'),
          '--config',
          config,
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--strictPort',
        ],
        {cwd: desktopDirectory, env: desktopEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe']},
      )
      rendererServers.push(renderer)
      renderer.stdout?.on('data', (chunk: Buffer) => appendFileSync(startupLog, chunk))
      renderer.stderr?.on('data', (chunk: Buffer) => appendFileSync(startupLog, chunk))
      await waitForUrl(`http://127.0.0.1:${port}/`, 120000)
    }
    const desktopDaemonUrl = `http://127.0.0.1:${desktopDaemonHttpPort}`
    if (env) await waitForUrl(`${desktopDaemonUrl}/debug/version`, 120000)
    if (env) {
      const daemon = createPromiseClient(Daemon, createGrpcWebTransport({baseUrl: desktopDaemonUrl}))
      const importedKey = await daemon.registerKey({
        mnemonic: FIXTURE_ACCOUNT_MNEMONIC.split(' '),
        passphrase: '',
        name: 'design-baseline',
      })
      if (importedKey.accountId !== FIXTURE_ACCOUNT_ID) {
        throw new Error(`Imported desktop key does not match fixture account ${FIXTURE_ACCOUNT_ID}`)
      }
    }
    const mainEntry = path.join(ROOT, 'frontend/apps/desktop/.vite/build/main.js')
    if (!existsSync(mainEntry)) throw new Error(`Desktop dev entry was not built: ${mainEntry}`)
    const electronPath = createRequire(path.join(ROOT, 'frontend/apps/desktop/package.json'))('electron') as string
    electronApp = await _electron.launch({
      executablePath: electronPath,
      args: [mainEntry, '--disable-gpu', '--disable-software-rasterizer', '--no-sandbox'],
      env: desktopEnv,
      cwd: path.join(ROOT, 'frontend/apps/desktop'),
      timeout: 120000,
    })
    electronApp.process().stdout?.on('data', (chunk: Buffer) => appendFileSync(startupLog, chunk))
    electronApp.process().stderr?.on('data', (chunk: Buffer) => appendFileSync(startupLog, chunk))
    electronApp.on('window', (window) => {
      appendFileSync(startupLog, `Electron window opened: ${window.url()}\n`)
    })
    let page: Page | undefined
    const rendererDeadline = Date.now() + 120000
    while (!page && Date.now() < rendererDeadline) {
      for (const candidate of electronApp.windows()) {
        if (candidate.isClosed()) continue
        try {
          if (new URL(candidate.url()).port === '5173') {
            page = candidate
            break
          }
        } catch {}
      }
      if (!page) await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (!page) {
      const openWindows = electronApp
        .windows()
        .map((window) => (window.isClosed() ? 'closed' : window.url()))
        .join(', ')
      throw new Error(`Timed out waiting for a live Electron renderer window on port 5173; windows: ${openWindows}`)
    }
    appendFileSync(startupLog, `Renderer window ready: ${page.url()}\n`)
    await electronApp.evaluate(({BrowserWindow}) => {
      BrowserWindow.getAllWindows().forEach((window) => window.setContentSize(1440, 900))
    })
    await page.locator('body').waitFor({state: 'visible', timeout: 20000})
    await page.waitForFunction(() => window.innerWidth === 1440 && window.innerHeight === 900, undefined, {
      timeout: 10000,
    })
    for (const theme of CAPTURE_THEMES) {
      currentView = 'onboarding'
      await captureDesktopView(page, manifest, options, 'onboarding', theme, async () => {
        const home = page.getByText('Home', {exact: true}).first()
        if (await home.count()) await home.click()
        await page.getByText(/Welcome to Seed Hypermedia/).waitFor({state: 'visible', timeout: 10000})
      })
    }

    currentView = 'fixture-seed'
    if (!env) {
      await waitForUrl(`${desktopDaemonUrl}/debug/version`, 120000)
      await page.reload({waitUntil: 'domcontentloaded'})
      await page.locator('body').waitFor({state: 'visible', timeout: 20000})
    }

    for (const theme of CAPTURE_THEMES) {
      currentView = 'library-home'
      await captureDesktopView(page, manifest, options, 'library-home', theme, async () => {
        const home = page.getByText('Home', {exact: true}).first()
        if (await home.count()) await home.click()
        await page.locator('body').waitFor({state: 'visible', timeout: 10000})
        const bodyText = await page.locator('body').innerText()
        if (!bodyText.trim()) throw new Error('Desktop Home view is blank')
      })
      currentView = 'article'
      await captureDesktopView(page, manifest, options, 'article', theme, () => openDesktopArticle(page))
      await captureDesktopView(page, manifest, options, 'new-draft-slash-menu', theme, async () => {
        const createButton = page.getByRole('button', {name: /new document|create document|new page/i}).first()
        await createButton.click()
        const editor = page.locator('[contenteditable="true"]').last()
        await editor.waitFor({state: 'visible', timeout: 15000})
        await editor.click()
        await page.keyboard.press('/')
        await page
          .getByText(/heading|paragraph|list/i)
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'activity-feed', theme, async () => {
        const home = page.getByText('Home', {exact: true}).first()
        if (await home.count()) await home.click()
        const feed = page.getByRole('button', {name: /activity|feed/i}).first()
        await feed.click()
        await page
          .getByText(/activity|feed/i)
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'comments', theme, async () => {
        await openDesktopArticle(page)
        const comments = page.getByRole('button', {name: /comments|discussion/i}).first()
        await comments.click()
        await page
          .getByText(/discussion|comments/i)
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'settings-general', theme, async () => {
        await page.getByText(/General settings/i).waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'settings-appearance', theme, async () => {
        await page.getByText('APPEARANCE', {exact: true}).waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'site-settings', theme, async () => {
        await openDesktopArticle(page)
        const settings = page.getByRole('button', {name: /space settings|site settings/i}).first()
        if (await settings.count()) await settings.click()
        else {
          await page
            .getByRole('button', {name: /account|profile|avatar/i})
            .first()
            .click()
          await page
            .getByRole('menuitem', {name: /site settings|space settings/i})
            .first()
            .click()
        }
        await page
          .getByText(/site settings|space settings/i)
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'account-menu', theme, async () => {
        const account = page.getByRole('button', {name: /account|profile|avatar/i}).first()
        await account.click()
        await page.getByRole('menu').waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'search-quick-switcher', theme, async () => {
        const home = page.getByText('Home', {exact: true}).first()
        if (await home.count()) await home.click()
        await page.keyboard.press('Control+k')
        await page
          .locator('[role="dialog"], input[placeholder*="Search" i]')
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
    }
  } catch (error) {
    const reason = `${errorMessage(error)}${existsSync(startupLog) ? ` (see ${startupLog})` : ''}`
    addFailure(manifest, {surface: 'desktop', view: currentView, viewport: 'desktop', error: reason})
  } finally {
    await electronApp?.close().catch(() => {})
    for (const renderer of rendererServers) {
      if (!renderer.pid) continue
      try {
        process.kill(-renderer.pid, 'SIGTERM')
        renderer.kill('SIGTERM')
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5000)
          renderer.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
        if (renderer.exitCode === null && renderer.signalCode === null) {
          try {
            process.kill(-renderer.pid, 'SIGKILL')
          } catch {}
          renderer.kill('SIGKILL')
        }
      } catch {}
    }
    rmSync(dataDir, {recursive: true, force: true})
  }
}

async function closeServer(server?: Server): Promise<void> {
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function main(): Promise<void> {
  const commit = execFile('git', ['rev-parse', 'HEAD'])
  const options = parseOptions(process.argv.slice(2))
  mkdirSync(options.out, {recursive: true})
  const manifest = createManifest(commit, new Date().toISOString())
  let browser: Browser | undefined
  let env: TestEnv | undefined
  const buildErrors = new Map<string, string>()
  try {
    if (!options.skipBuild) {
      const builds = [
        ['storybook', ['--filter', '@shm/ui', 'storybook:build']],
        ['playground', ['--filter', '@shm/design-playground', 'build']],
        ...(options.only.has('web') || options.only.has('vault') || options.only.has('desktop')
          ? [['web', ['--filter', '@shm/web', 'build']] as [string, string[]]]
          : []),
      ] as Array<[string, string[]]>
      for (const [surface, args] of builds) {
        if (!options.only.has(surface) && !(surface === 'web' && options.only.has('vault'))) continue
        try {
          runCommand('pnpm', args)
        } catch (error) {
          buildErrors.set(surface, errorMessage(error))
        }
      }
    }
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--enable-experimental-web-platform-features'],
      })
    } catch (error) {
      const message = errorMessage(error)
      for (const surface of ['storybook', 'emails', 'web', 'vault', 'playground']) {
        if (options.only.has(surface)) {
          addStartupFailure(manifest, surface, message)
        }
      }
    }
    if (options.only.has('web') || options.only.has('vault') || options.only.has('desktop')) {
      if (!buildErrors.has('web')) {
        try {
          const desktopSelected = options.only.has('desktop')
          env = await setupTestEnv({
            webPort: WEB_PORT,
            daemonHttpPort: desktopSelected ? DESKTOP_DAEMON_HTTP_PORT : DAEMON_HTTP_PORT,
            daemonGrpcPort: desktopSelected ? DESKTOP_DAEMON_GRPC_PORT : DAEMON_GRPC_PORT,
            daemonP2pPort: desktopSelected ? DESKTOP_P2P_PORT : DAEMON_P2P_PORT,
            ...(desktopSelected ? {daemonAllowedOrigins: ['http://localhost:5173']} : {}),
            skipBuild: true,
          })
        } catch (error) {
          for (const surface of ['web', 'vault']) {
            if (options.only.has(surface)) {
              addStartupFailure(manifest, surface, errorMessage(error))
            }
          }
        }
      }
    }
    if (env && (options.only.has('web') || options.only.has('desktop'))) {
      try {
        await seedDesignInventory(env.web.baseUrl, FIXTURE_ACCOUNT)
      } catch (error) {
        for (const surface of ['web', 'desktop'] as const) {
          if (options.only.has(surface)) {
            addStartupFailure(manifest, surface, `Failed to seed shared design fixtures: ${errorMessage(error)}`)
          }
        }
      }
    }
    for (const surface of ['storybook', 'playground', 'emails', 'web', 'vault'] as const) {
      if (!options.only.has(surface)) continue
      if (buildErrors.has(surface) || (surface === 'vault' && buildErrors.has('web'))) {
        addStartupFailure(manifest, surface, buildErrors.get(surface) ?? buildErrors.get('web')!)
        continue
      }
      if (!browser) continue
      try {
        if (surface === 'storybook') await captureStorybook(browser, manifest, options)
        else if (surface === 'playground') await capturePlayground(browser, manifest, options)
        else if (surface === 'emails') await captureEmails(browser, manifest, options)
        else if (surface === 'web' && env) await captureWeb(browser, manifest, options, env)
        else if (surface === 'vault' && env) await captureVault(browser, manifest, options, env)
      } catch (error) {
        addFailure(manifest, {surface, view: 'capture', error: errorMessage(error)})
      }
    }
    if (options.only.has('desktop')) {
      if (browser) {
        await browser.close()
        browser = undefined
      }
      await captureDesktop(manifest, options, env)
    }
  } finally {
    await browser?.close().catch(() => {})
    await env?.cleanup().catch((error) => console.error(`Test environment cleanup failed: ${errorMessage(error)}`))
    const selectedSurfaces = [...options.only].sort()
    const manifestName = selectedSurfaces.length === 6 ? 'manifest.json' : `manifest-${selectedSurfaces.join('-')}.json`
    const manifestPath = path.join(options.out, manifestName)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const counts = Object.fromEntries(
      Object.entries(manifest.surfaces).map(([surface, captures]) => [surface, captures.length]),
    )
    console.log(`Capture manifest: ${manifestPath}`)
    console.log(`Screenshot counts: ${JSON.stringify(counts)}`)
    console.log(`Failures: ${manifest.failures.length}`)
    if (manifest.failures.length) process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
