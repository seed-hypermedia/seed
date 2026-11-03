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
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {chromium, type Browser, type BrowserContext, type Locator, type Page, type Video} from 'playwright'
import {createDocumentUpdate, type TestAccount} from '../../frontend/apps/cli/src/test/account-helpers'
import {FIXTURE_ACCOUNT, FIXTURE_ACCOUNT_ID} from '../../frontend/apps/cli/src/test/fixture-seed'
import {
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
const VAULT_PORT = 59104
const STORYBOOK_PORT = 59200
const PLAYGROUND_PORT = 59201
const MASK_SELECTORS = ['.relative-time', '[data-relative-time]', 'time[data-relative]']

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
          await page.locator('#storybook-root').waitFor({state: 'visible', timeout: 20000})
          await capturePage(manifest, options.out, 'storybook', story.id, theme, 'desktop', page, true, url.toString())
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
    'search-command': '/',
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
  await seedDesignInventory(env.web.baseUrl, FIXTURE_ACCOUNT)
  for (const theme of CAPTURE_THEMES) {
    for (const viewport of Object.keys(CAPTURE_VIEWPORTS) as CaptureViewport[]) {
      for (const view of captureViews('web')) {
        await withPage(browser, theme, viewport, async (page) => {
          const url = await openWebView(page, env.web.baseUrl, view)
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
          if (view === 'search-command') {
            await page.keyboard.press('Control+k')
            const searchSurface = page.locator('[role="dialog"], [cmdk-root], input[placeholder*="Search" i]').first()
            await searchSurface.waitFor({state: 'visible', timeout: 5000})
          }
          await capturePage(manifest, options.out, 'web', view, theme, viewport, page, true, url)
        }).catch((error) => addFailure(manifest, {surface: 'web', view, theme, viewport, error: errorMessage(error)}))
      }
    }
  }
}

async function captureVault(
  browser: Browser,
  manifest: CaptureManifest,
  options: Options,
  env: TestEnv,
): Promise<void> {
  let vault: VaultServerInstance | undefined
  try {
    vault = await startVaultServer({
      port: VAULT_PORT,
      backendHttpPort: DAEMON_HTTP_PORT,
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

      const signup = page.getByRole('button', {name: /create|sign up|new identity/i}).first()
      await signup.click({timeout: 10000})
      const passwordField = page.getByLabel(/password/i).first()
      await passwordField.waitFor({state: 'visible', timeout: 15000})
      await captureVaultVariants(manifest, options.out, page, 'signup-password', page.url())

      const email = `design-baseline-${Date.now()}@example.com`
      const password = 'Design-Baseline-Password-7319!'
      const emailField = page.getByLabel(/email/i).first()
      if (await emailField.count()) await emailField.fill(email)
      await passwordField.fill(password)
      const continueButton = page.getByRole('button', {name: /continue|create|sign up|next/i}).last()
      await continueButton.click()
      if (await page.getByLabel(/verification code|code/i).count()) {
        const code = await vault.waitForVerificationCode(email, 30000)
        await page
          .getByLabel(/verification code|code/i)
          .first()
          .fill(code)
        await page
          .getByRole('button', {name: /verify|continue|confirm/i})
          .last()
          .click()
      }
      await page
        .getByText(/recovery words|recovery phrase|write these words/i)
        .waitFor({state: 'visible', timeout: 30000})
      await captureVaultVariants(manifest, options.out, page, 'recovery-words', page.url())

      const signOut = page.getByRole('button', {name: /sign out|log out/i}).first()
      if (await signOut.count()) await signOut.click()
      else await page.goto(vault.vaultUrl, {waitUntil: 'domcontentloaded'})
      await page.getByLabel(/password/i).waitFor({state: 'visible', timeout: 15000})
      await captureVaultVariants(manifest, options.out, page, 'sign-in', page.url())
    } finally {
      await context.close()
    }
  } catch (error) {
    recordUnavailable(manifest, 'vault', captureViews('vault'), errorMessage(error))
  } finally {
    await vault?.kill()
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
  const settingsButton = page.getByRole('button', {name: /app settings/i}).first()
  if (await settingsButton.count()) await settingsButton.click()
  else
    await page
      .getByRole('button', {name: /settings/i})
      .first()
      .click()

  const radio = page.getByRole('radio', {name: new RegExp(`^${theme}$`, 'i')}).first()
  await radio.waitFor({state: 'visible', timeout: 10000})
  await radio.check()
  await page.waitForFunction(
    (expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'),
    theme,
    {timeout: 10000},
  )
}

async function openDesktopArticle(page: Page, origin: string): Promise<void> {
  await page.goto(origin, {waitUntil: 'domcontentloaded'}).catch(() => {})
  const title = page.getByText(FIXTURE_DESIGN_INVENTORY_TITLE, {exact: true}).first()
  if (await title.count()) {
    await title.click()
  } else {
    const search = page.getByRole('button', {name: /search/i}).first()
    if (await search.count()) {
      await search.click()
      const input = page.getByRole('textbox').first()
      await input.fill(FIXTURE_DESIGN_INVENTORY_TITLE)
      await page.getByText(FIXTURE_DESIGN_INVENTORY_TITLE, {exact: true}).first().click()
    }
  }
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

async function captureDesktop(manifest: CaptureManifest, options: Options): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'seed-design-desktop-'))
  const startupLog = path.join(options.out, 'desktop-startup.log')
  let child: ChildProcess | undefined
  let cdpBrowser: Browser | undefined
  try {
    const desktopEnv = {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ':0',
      SEED_FIXTURE_DATA_DIR: dataDir,
      DAEMON_HTTP_PORT: String(DESKTOP_DAEMON_HTTP_PORT),
      VITE_DESKTOP_P2P_PORT: String(DESKTOP_P2P_PORT),
      VITE_DESKTOP_HTTP_PORT: String(DESKTOP_DAEMON_HTTP_PORT),
      VITE_DESKTOP_GRPC_PORT: String(DESKTOP_DAEMON_GRPC_PORT),
      VITE_DESKTOP_API_PORT: '58104',
      VITE_DESKTOP_DEFAULT_AGENTS_URL: 'http://127.0.0.1:58105',
    }
    child = spawn(
      'pnpm',
      [
        '--filter',
        '@shm/desktop',
        'dev',
        '--',
        '--remote-debugging-port=58106',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--no-sandbox',
      ],
      {
        cwd: ROOT,
        env: desktopEnv,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    child.stdout?.on('data', (chunk: Buffer) => appendFileSync(startupLog, chunk))
    child.stderr?.on('data', (chunk: Buffer) => appendFileSync(startupLog, chunk))
    await waitForUrl('http://127.0.0.1:58106/json/version', 120000)
    cdpBrowser = await chromium.connectOverCDP('http://127.0.0.1:58106')
    const context = cdpBrowser.contexts()[0]
    const page = context.pages()[0] ?? (await context.newPage())
    await page.setViewportSize(CAPTURE_VIEWPORTS.desktop)
    await page.locator('body').waitFor({state: 'visible', timeout: 20000})
    const origin = new URL(page.url()).origin
    for (const theme of CAPTURE_THEMES) {
      await setDesktopTheme(page, theme)
      await page.goto(origin, {waitUntil: 'domcontentloaded'})
      await page.waitForFunction(
        (expected) => document.documentElement.classList.contains('dark') === (expected === 'dark'),
        theme,
        {timeout: 10000},
      )
      const bodyText = await page.locator('body').innerText()
      if (!bodyText.trim()) throw new Error('Desktop onboarding screen is blank')
      await capturePage(manifest, options.out, 'desktop', 'onboarding', theme, 'desktop', page, true)
    }

    await waitForUrl(`http://127.0.0.1:${DESKTOP_DAEMON_HTTP_PORT}/debug/version`, 120000)
    await seedTestFixtures(`http://127.0.0.1:${DESKTOP_DAEMON_HTTP_PORT}`)
    await seedDesignInventory(`http://127.0.0.1:${DESKTOP_DAEMON_HTTP_PORT}`, FIXTURE_ACCOUNT)
    await page.reload({waitUntil: 'domcontentloaded'})
    await page.locator('body').waitFor({state: 'visible', timeout: 20000})

    for (const theme of CAPTURE_THEMES) {
      await captureDesktopView(page, manifest, options, 'library-home', theme, async () => {
        await page.goto(origin, {waitUntil: 'domcontentloaded'})
        await page
          .getByText(/Design inventory|Design notes/i)
          .first()
          .waitFor({state: 'visible', timeout: 15000})
      })
      await captureDesktopView(page, manifest, options, 'article', theme, () => openDesktopArticle(page, origin))
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
        await page.goto(origin, {waitUntil: 'domcontentloaded'})
        const feed = page.getByRole('button', {name: /activity|feed/i}).first()
        await feed.click()
        await page
          .getByText(/activity|feed/i)
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'comments', theme, async () => {
        await openDesktopArticle(page, origin)
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
        const appearance = page.getByRole('button', {name: /appearance/i}).first()
        if (await appearance.count()) await appearance.click()
        await page
          .getByText(/appearance/i)
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
      await captureDesktopView(page, manifest, options, 'site-settings', theme, async () => {
        await openDesktopArticle(page, origin)
        const settings = page.getByRole('button', {name: /space settings|site settings/i}).first()
        await settings.click()
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
        await page.goto(origin, {waitUntil: 'domcontentloaded'})
        await page.keyboard.press('Control+k')
        await page
          .locator('[role="dialog"], input[placeholder*="Search" i]')
          .first()
          .waitFor({state: 'visible', timeout: 10000})
      })
    }
  } catch (error) {
    const reason = `${errorMessage(error)}${existsSync(startupLog) ? ` (see ${startupLog})` : ''}`
    for (const view of captureViews('desktop')) {
      for (const theme of CAPTURE_THEMES) {
        const alreadyRecorded = manifest.surfaces.desktop?.some((entry) => entry.view === view && entry.theme === theme)
        const alreadyFailed = manifest.failures.some(
          (failure) => failure.surface === 'desktop' && failure.view === view && failure.theme === theme,
        )
        if (!alreadyRecorded && !alreadyFailed) {
          addFailure(manifest, {surface: 'desktop', view, theme, viewport: 'desktop', error: reason})
        }
      }
    }
  } finally {
    await cdpBrowser?.close().catch(() => {})
    if (child?.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM')
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5000)
          child?.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      } catch {}
    }
    rmSync(dataDir, {recursive: true, force: true})
  }
}

function recordUnavailable(
  manifest: CaptureManifest,
  surface: string,
  views: readonly string[],
  error: string,
  themes: readonly CaptureTheme[] = CAPTURE_THEMES,
  viewports?: readonly CaptureViewport[],
): void {
  const selectedViewports = viewports ?? (Object.keys(CAPTURE_VIEWPORTS) as CaptureViewport[])
  for (const view of views) {
    for (const theme of themes) {
      for (const viewport of selectedViewports) {
        const alreadyRecorded = manifest.surfaces[surface]?.some(
          (entry) => entry.view === view && entry.theme === theme && entry.viewport === viewport,
        )
        const alreadyFailed = manifest.failures.some(
          (failure) =>
            failure.surface === surface &&
            failure.view === view &&
            failure.theme === theme &&
            failure.viewport === viewport,
        )
        if (!alreadyRecorded && !alreadyFailed) addFailure(manifest, {surface, view, theme, viewport, error})
      }
    }
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
        ...(options.only.has('web') || options.only.has('vault')
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
          const views =
            surface === 'storybook'
              ? ['all-stories']
              : surface === 'playground'
                ? ['compositions']
                : captureViews(surface as 'emails' | 'web' | 'vault')
          recordUnavailable(
            manifest,
            surface,
            views,
            message,
            surface === 'emails' ? ['light'] : CAPTURE_THEMES,
            surface === 'storybook' ? ['desktop'] : surface === 'emails' ? ['desktop', 'mobile'] : undefined,
          )
        }
      }
    }
    if ((options.only.has('web') || options.only.has('vault')) && browser) {
      if (buildErrors.has('web')) {
        for (const surface of ['web', 'vault']) {
          if (options.only.has(surface))
            recordUnavailable(manifest, surface, captureViews(surface as 'web' | 'vault'), buildErrors.get('web')!)
        }
      } else {
        try {
          env = await setupTestEnv({
            webPort: WEB_PORT,
            daemonHttpPort: DAEMON_HTTP_PORT,
            daemonGrpcPort: DAEMON_GRPC_PORT,
            daemonP2pPort: DAEMON_P2P_PORT,
            skipBuild: true,
          })
        } catch (error) {
          for (const surface of ['web', 'vault']) {
            if (options.only.has(surface))
              recordUnavailable(manifest, surface, captureViews(surface as 'web' | 'vault'), errorMessage(error))
          }
        }
      }
    }
    for (const surface of ['storybook', 'playground', 'emails', 'web', 'vault'] as const) {
      if (!options.only.has(surface)) continue
      if (buildErrors.has(surface)) {
        const views =
          surface === 'storybook'
            ? ['all-stories']
            : surface === 'playground'
              ? ['compositions']
              : captureViews(surface as 'emails' | 'web' | 'vault')
        recordUnavailable(
          manifest,
          surface,
          views,
          buildErrors.get(surface)!,
          surface === 'emails' ? ['light'] : CAPTURE_THEMES,
          surface === 'storybook' ? ['desktop'] : surface === 'emails' ? ['desktop', 'mobile'] : undefined,
        )
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
        const views =
          surface === 'storybook'
            ? ['all-stories']
            : surface === 'playground'
              ? ['compositions']
              : captureViews(surface as 'emails' | 'web' | 'vault')
        recordUnavailable(
          manifest,
          surface,
          views,
          errorMessage(error),
          surface === 'emails' ? ['light'] : CAPTURE_THEMES,
          surface === 'storybook' ? ['desktop'] : surface === 'emails' ? ['desktop', 'mobile'] : undefined,
        )
      }
    }
    if (options.only.has('desktop')) await captureDesktop(manifest, options)
  } finally {
    await browser?.close().catch(() => {})
    await env?.cleanup().catch((error) => console.error(`Test environment cleanup failed: ${errorMessage(error)}`))
    const manifestPath = path.join(options.out, 'manifest.json')
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
