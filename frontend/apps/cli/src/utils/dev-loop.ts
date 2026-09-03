/**
 * The Repo HM sync dev loop behind `seed-cli space dev` (and sync-hypermedia.ts
 * dev): publish a directory of markdown into the daemon behind a running
 * desktop dev app under a throwaway key, then keep the two in step both ways:
 * every document published in the app is written back into the directory, and
 * every .md or .schema.json changed on disk is pushed into the daemon.
 *
 * The app is the editor; git is where you commit. The dev daemon is a peer
 * like any other, so the site does propagate to whatever network it is on;
 * only the dev daemon is watched, though.
 */
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {createSeedClient, type HMSigner, type SeedClient} from '@seed-hypermedia/client'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {spawn} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, unlinkSync, watch, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {printInfo, printSuccess, printWarning} from '../output'
import {deriveKeyPairFromMnemonic, generateMnemonic, type KeyPair} from './key-derivation'
import {createSignerFromKey} from './signer'
import {
  exportPath,
  exportSpace,
  grantWriters,
  importSpace,
  listSpaceVersions,
  type ImportOptions,
  type SpaceLayout,
} from './space-sync'

/** The unencrypted dev key: a mnemonic in `<dir>/.dev/` (self-ignored), created on first use. */
function loadOrCreateDevKey(dir: string): {keyPair: KeyPair; words: string[]; created: boolean} {
  const devDir = resolve(dir, '.dev')
  const file = resolve(devDir, 'dev-key.mnemonic')
  let words: string[]
  let created = false
  if (existsSync(file)) {
    words = readFileSync(file, 'utf8').trim().split(/\s+/)
  } else {
    words = generateMnemonic(12).split(' ')
    mkdirSync(devDir, {recursive: true})
    writeFileSync(resolve(devDir, '.gitignore'), '*\n')
    writeFileSync(file, words.join(' ') + '\n', {mode: 0o600})
    created = true
  }
  return {keyPair: deriveKeyPairFromMnemonic(words), words, created}
}

/**
 * Make sure the daemon holds the dev key, so the app can edit as that account.
 * Returns every key the daemon holds (name + account id).
 */
async function ensureDaemonKey(
  daemonUrl: string,
  words: string[],
  accountId: string,
): Promise<Array<{name: string; publicKey: string}>> {
  const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: daemonUrl}))
  const existing = await grpc.daemon.listKeys({})
  if (!existing.keys.some((k) => k.publicKey === accountId)) {
    const name = `dev-${accountId.slice(-6)}`
    await grpc.daemon.registerKey({mnemonic: words, name})
    printInfo(`Registered key "${name}" in the daemon.`)
  }
  const keys = await grpc.daemon.listKeys({})
  return keys.keys.map((k) => ({name: k.name, publicKey: k.publicKey}))
}

/**
 * Open a URL in the running desktop dev app. `open hm://…` would hand the URL
 * to whichever app the OS has registered for the scheme, usually the
 * production Seed app, whose daemon is not the one this loop watches. The dev
 * app holds Electron's single-instance lock, so launching a second dev
 * instance with the URL as an argument forwards it to the running one
 * (`second-instance` in the desktop main process) and exits.
 * Returns false when the dev checkout or its Electron binary cannot be found.
 */
function openInDevApp(url: string): boolean {
  const repoRoot = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)))
  const desktopDir = resolve(repoRoot, 'frontend/apps/desktop')
  const candidates =
    process.platform === 'darwin'
      ? ['node_modules/electron/dist/Electron.app/Contents/MacOS/Electron']
      : process.platform === 'win32'
        ? ['node_modules/electron/dist/electron.exe']
        : ['node_modules/electron/dist/electron']
  const electron = candidates.map((c) => resolve(repoRoot, c)).find((c) => existsSync(c))
  if (!electron || !existsSync(resolve(desktopDir, '.vite/build/main.js'))) return false
  try {
    const child = spawn(electron, ['.', url], {cwd: desktopDir, stdio: 'ignore', detached: true})
    child.unref()
    return true
  } catch {
    return false
  }
}

/** Block until the daemon (gRPC-web) and the desktop app's HTTP API both answer. */
async function waitForDevApp(daemonUrl: string, apiUrl: string): Promise<void> {
  const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: daemonUrl}))
  const daemonUp = () =>
    grpc.daemon.listKeys({}).then(
      () => true,
      () => false,
    )
  // Any HTTP answer means the app's API server is listening (404 included).
  const apiUp = () =>
    fetch(`${apiUrl}/api/`).then(
      () => true,
      () => false,
    )
  let announced = false
  for (;;) {
    const [daemon, api] = await Promise.all([daemonUp(), apiUp()])
    if (daemon && api) {
      if (announced) printInfo('Desktop dev app is up.')
      return
    }
    if (!announced) {
      printInfo(
        `Waiting for the desktop dev app (daemon ${daemonUrl}${daemon ? ' ok' : ''}, API ${apiUrl}${
          api ? ' ok' : ''
        })...`,
      )
      announced = true
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

export type DevLoopOptions = {
  dir: string
  apiUrl: string
  daemonUrl: string
  intervalMs: number
  /** Publish the directory into the daemon first (default true). */
  push: boolean
  /** How documents map onto files; the default layout unless the directory has its own. */
  layout?: SpaceLayout
  metadataFor?: ImportOptions['metadataFor']
  /** Runs before the directory is pushed, e.g. to publish blobs the documents reference. */
  beforePush?: (ctx: {client: SeedClient; signer: HMSigner; account: string}) => Promise<void>
  /** Called after each tick that wrote files, with the files written. */
  onWritten?: (files: string[]) => void
  /** Watch the files too and push a changed .md / .schema.json (default true). */
  watchFiles?: boolean
  /** Called after a file change was pushed, with the files pushed. */
  onPushed?: (files: string[]) => void
}

/** The dev loop behind `space dev`, reusable by directories with their own layout (see sync-hypermedia.ts). */
export async function runDevLoop(opts: DevLoopOptions) {
  const {keyPair, words, created} = loadOrCreateDevKey(opts.dir)
  const account = keyPair.accountId
  printInfo(`Dev key: ${account}${created ? ' (new; saved under .dev/ in the directory)' : ''}`)
  printInfo(`Daemon:  ${opts.daemonUrl}`)
  printInfo(`API:     ${opts.apiUrl}`)

  // Under `./dev up` this pane starts while the desktop pane is still building
  // the app and its daemon, so wait for both rather than fail.
  await waitForDevApp(opts.daemonUrl, opts.apiUrl)
  const localKeys = await ensureDaemonKey(opts.daemonUrl, words, account)

  const client = createSeedClient(opts.apiUrl)
  const signer = createSignerFromKey(keyPair)

  // Every account in the app can edit the dev site, not just the dev key.
  await grantWriters({client, signer, account, log: printInfo}, localKeys)

  const layout = opts.layout
  if (opts.push) {
    if (opts.beforePush) await opts.beforePush({client, signer, account})
    printInfo('Publishing the directory into the local daemon...')
    const result = await importSpace({
      client,
      signer,
      account,
      dir: opts.dir,
      layout,
      metadataFor: opts.metadataFor,
      log: printInfo,
    })
    printInfo(
      `${result.created.length} created, ${result.moved.length} moved, ${result.updated.length} updated, ${result.unchanged.length} unchanged.`,
    )
  }

  const url = `hm://${account}`
  printSuccess(`Site: ${url}`)
  if (openInDevApp(url)) {
    printInfo('Opened in the desktop DEV app. Edit and publish there; files update here.')
  } else {
    printInfo('Paste the URL into the omnibar of the desktop DEV app. Edit and publish there; files update here.')
  }
  printWarning(
    'Only the dev app (the one behind ' +
      opts.daemonUrl +
      ') is watched. The production Seed app registers the same hm:// scheme, so do not open the site from a link: edits made there never reach this directory.',
  )

  let versions = await listSpaceVersions(client, account)
  // Which file each document lives in, so a document moved in the app takes
  // its file along (the old one is removed).
  const files = (await exportSpace({client, uid: account, dir: opts.dir, layout})).files
  const stamp = () => new Date().toLocaleTimeString()

  // ── files → daemon ──
  // Both sides are watched. The daemon side wins nothing: a file changed on
  // disk (a checkout, a pull, a hand edit) is pushed as it is, because git is
  // the source of truth. The loop's own write-backs are not hand edits, so a
  // file it wrote moments ago is ignored when the watcher reports it.
  const selfWrites = new Map<string, number>()
  const noteSelfWrite = (file: string) => selfWrites.set(file, Date.now())
  const pending = new Set<string>()
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  let pushing: Promise<void> = Promise.resolve()
  const pushPending = () => {
    pushing = pushing.then(async () => {
      const batch = Array.from(pending)
      pending.clear()
      const mdFiles = new Set<string>()
      for (const f of batch) {
        if (f.endsWith('.md')) mdFiles.add(f)
        else if (f.endsWith('.schema.json')) mdFiles.add(f.replace(/\.schema\.json$/, '.md'))
      }
      const only = Array.from(mdFiles).filter((f) => existsSync(resolve(opts.dir, f)))
      for (const f of mdFiles) {
        if (!only.includes(f))
          printInfo(`${stamp()}  ${f} is gone from disk; its document stays until deleted in the app`)
      }
      if (!only.length) return
      try {
        const result = await importSpace({
          client,
          signer,
          account,
          dir: opts.dir,
          layout,
          metadataFor: opts.metadataFor,
          only,
          log: (line) => printInfo(`${stamp()}  ${line}`),
        })
        const pushed = [...result.created, ...result.updated, ...result.moved.map((m) => m.split(' -> ')[1] ?? m)]
        if (pushed.length && opts.onPushed) opts.onPushed(only)
      } catch (err) {
        printWarning(`${stamp()}  push failed: ${(err as Error).message}`)
      }
    })
  }
  if (opts.watchFiles !== false) {
    try {
      watch(opts.dir, {recursive: true}, (_event, filename) => {
        if (!filename) return
        const rel = String(filename).replace(/\\/g, '/')
        if (rel.startsWith('.') || rel.includes('/.')) return
        if (!rel.endsWith('.md') && !rel.endsWith('.schema.json')) return
        const wrote = selfWrites.get(rel)
        if (wrote !== undefined && Date.now() - wrote < 3000) return
        pending.add(rel)
        if (pushTimer) clearTimeout(pushTimer)
        pushTimer = setTimeout(pushPending, 600)
      })
      printInfo('Watching the files too: a changed .md or .schema.json is pushed into the daemon (the file wins).')
    } catch (err) {
      printWarning(`Cannot watch the files (${(err as Error).message}); hand edits are pushed on the next start.`)
    }
  }

  // ── daemon → files ──
  printInfo(`Watching ${versions.size} documents every ${opts.intervalMs}ms. Ctrl-C to stop.`)
  for (;;) {
    await new Promise((r) => setTimeout(r, opts.intervalMs))
    await pushing
    let next: Map<string, string>
    try {
      next = await listSpaceVersions(client, account)
    } catch (err) {
      printWarning(`poll failed: ${(err as Error).message}`)
      continue
    }
    const written: string[] = []
    for (const [path, version] of next) {
      if (versions.get(path) === version) continue
      try {
        const res = await exportPath({client, uid: account, dir: opts.dir, layout}, path)
        for (const file of res.written) {
          noteSelfWrite(file)
          printInfo(`${stamp()}  wrote ${file}`)
        }
        written.push(...res.written)
        if (res.written.length === 0) printInfo(`${stamp()}  ${path || '(home)'} republished, no file change`)
        if (res.file) files.set(path, res.file)
      } catch (err) {
        printWarning(`${path || '(home)'}: ${(err as Error).message}`)
      }
    }
    // A path that vanished was moved away (or deleted): drop its file.
    for (const [path] of versions) {
      if (next.has(path)) continue
      const file = files.get(path)
      if (!file) continue
      try {
        noteSelfWrite(file)
        unlinkSync(resolve(opts.dir, file))
        printInfo(`${stamp()}  removed ${file}`)
      } catch {
        // already gone
      }
      files.delete(path)
    }
    versions = next
    if (written.length && opts.onWritten) opts.onWritten(written)
  }
}
