/**
 * The desktop app, isolated for the user stories: its own appdata (`Seed-e2e`), its own daemon
 * ports (58100–58105), and none of the shell's dev-app settings (direnv exports DAEMON_* and
 * VITE_DESKTOP_* for the dev app on 58000–58004, which must never be touched). The packaged
 * build comes from `pnpm package:e2e`, which bakes the same ports in.
 */
import {_electron as electron, type ElectronApplication, type Page} from '@playwright/test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

export const APP_EXECUTABLE = path.resolve(__dirname, '../../out/Seed-darwin-arm64/Seed.app/Contents/MacOS/Seed')
export const APPDATA_NAME = 'Seed-e2e'
export const APPDATA = path.join(os.homedir(), 'Library/Application Support', APPDATA_NAME)
export const PORTS = {p2p: 58100, http: 58101, grpc: 58102, api: 58104, agents: 58105}
/** IPv4 on purpose: node's fetch resolves `localhost` to ::1, which the daemon does not listen on. */
export const DAEMON_URL = `http://127.0.0.1:${PORTS.http}`
export const API_URL = `http://127.0.0.1:${PORTS.api}`
/** Where the story specs leave their screenshots (git-ignored; the testing guide reproduces them). */
export const SHOTS_DIR = path.resolve(__dirname, '../../test-results/user-stories')

export type StoryApp = {
  app: ElectronApplication
  win: Page
  /** Screenshot + a compact dump of the interactive elements, for reading what the tester sees. */
  dump: (label: string) => Promise<string>
  shot: (label: string) => Promise<void>
}

/** Turn the Hypermedia Schemas switch on before the app starts (Settings → Developers does the same). */
function seedExperiments() {
  fs.mkdirSync(APPDATA, {recursive: true})
  const file = path.join(APPDATA, 'AppStore.json')
  const store = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
  store['Experiments-v001'] = {...(store['Experiments-v001'] ?? {}), hypermediaSchemas: true, developerTools: true}
  fs.writeFileSync(file, JSON.stringify(store, null, 2))
}

export async function launchStoryApp(opts: {fresh?: boolean; shots?: string} = {}): Promise<StoryApp> {
  if (opts.fresh) fs.rmSync(APPDATA, {recursive: true, force: true})
  seedExperiments()
  const shotsDir = opts.shots ?? SHOTS_DIR
  fs.mkdirSync(shotsDir, {recursive: true})
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env))
    if (v !== undefined && !/^(DAEMON_|VITE_DESKTOP_)/.test(k)) env[k] = v
  delete env.NODE_ENV
  Object.assign(env, {
    // Fixture mode: this directory persists across launches and the daemon keeps its keys in
    // files under it, instead of the per-launch temp directory NODE_ENV=test would use.
    SEED_FIXTURE_DATA_DIR: APPDATA,
    DAEMON_HTTP_PORT: String(PORTS.http),
    VITE_DESKTOP_P2P_PORT: String(PORTS.p2p),
    VITE_DESKTOP_HTTP_PORT: String(PORTS.http),
    VITE_DESKTOP_GRPC_PORT: String(PORTS.grpc),
    VITE_DESKTOP_API_PORT: String(PORTS.api),
    VITE_DESKTOP_DEFAULT_AGENTS_URL: `http://localhost:${PORTS.agents}`,
    VITE_DESKTOP_APPDATA: APPDATA_NAME,
    // Its own renderer static-server port, clear of a production app on the default 17654.
    SEED_LOCAL_SERVER_PORT: '58106',
  })
  const app = await electron.launch({executablePath: APP_EXECUTABLE, args: [], env, timeout: 90_000})
  app.process().stderr?.on('data', (d) => {
    const t = String(d)
    if (/EADDRINUSE|panic|FATAL/.test(t)) console.log('[app!]', t.trim().slice(0, 300))
  })
  const win = await app.firstWindow({timeout: 90_000})
  win.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    if (/Failed to load resource|GetVaultStatus|useVaultStatus|Function components/.test(text)) return
    console.log('[renderer]', text.split('\n').slice(0, 2).join(' | ').slice(0, 300))
  })
  win.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
  console.log('[renderer url]', win.url())
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${DAEMON_URL}/debug/version`)).ok) break
    } catch {}
    await win.waitForTimeout(500)
  }
  const shot = async (label: string) => {
    await win.screenshot({path: path.join(shotsDir, `${label}.png`)})
  }
  const dump = async (label: string) => {
    await shot(label)
    const texts = await win.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          'button, a, [role=button], [role=menuitem], [role=tab], [role=option], [role=switch], input, textarea, select, h1, h2, h3, [data-testid], [contenteditable=true]',
        ),
      )
        .filter((e) => (e as HTMLElement).offsetParent !== null || e.tagName === 'INPUT')
        .map((e) => {
          const id = e.getAttribute('data-testid') ? `#${e.getAttribute('data-testid')}` : ''
          const role = e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''
          const text = (e.textContent || e.getAttribute('placeholder') || e.getAttribute('aria-label') || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 80)
          const value =
            e instanceof HTMLInputElement || e instanceof HTMLTextAreaElement
              ? ` = ${JSON.stringify(e.value.slice(0, 60))}`
              : ''
          const name = e.getAttribute('name') ? `(name=${e.getAttribute('name')})` : ''
          return `${e.tagName.toLowerCase()}${id}${role}${name}: ${text || '·'}${value}`
        })
        .filter((t) => t.split(': ')[1]),
    )
    const out = `--- ${label}\n${texts.join('\n')}`
    console.log(out)
    return out
  }
  return {app, win, dump, shot}
}

/** The omnibar: Meta+K, type an address, Enter. */
export async function openAddress(win: Page, address: string) {
  await win.keyboard.press('Meta+k')
  await win.waitForTimeout(400)
  await win.keyboard.type(address, {delay: 5})
  await win.keyboard.press('Enter')
}
