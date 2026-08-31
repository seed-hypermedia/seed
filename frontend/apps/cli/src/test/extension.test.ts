/**
 * Extension command integration tests.
 *
 * Runs the real daemon + web server (same harness as cli-fixture.test.ts),
 * publishes an extension from a temp package directory, installs it on the
 * signing key's own site, and checks every step through `document get`.
 */

import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {registerAccount, type TestAccount} from './account-helpers'
import {runCli, startFullIntegrationWithFixture, type FullTestContext} from './setup'

let ctx: FullTestContext
const TEST_TIMEOUT = 180000

// BIP-39 test vector, distinct from the one cli-fixture.test.ts uses so the two files never share a keyring entry.
const SITE_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
const SITE_KEY_NAME = 'cli-extension-test'

const MANIFEST = {
  manifestVersion: 1,
  kind: 'page',
  version: '0.1.0',
  description: 'A tiny board for the CLI test',
  permissions: ['sign', 'navigate'],
  defaultMountPath: 'board',
  homepage: 'https://example.com/board',
}
const ENTRY_HTML =
  '<!doctype html><html><body><h1>Board</h1><script>document.body.dataset.ok = "1"</script></body></html>'
const README_V1 = '# Test Board\n\nA board extension for the fixture test.\n\n## Usage\n\nInstall it.\n'
const README_V2 = '# Test Board\n\nA board extension for the fixture test, now updated.\n'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getDocJson(hmId: string): Promise<any> {
  const result = await runCli(['document', 'get', hmId, '--json'], {server: ctx.webServerUrl})
  expect(result.exitCode).toBe(0)
  return JSON.parse(result.stdout)
}

describe('CLI extension commands', () => {
  let site: TestAccount
  let siteId: string
  let pkgDir: string
  let extensionId: string
  let firstVersion: string
  let entryCid: string

  beforeAll(async () => {
    ctx = await startFullIntegrationWithFixture()

    const importResult = await runCli(['key', 'import', '-n', SITE_KEY_NAME, SITE_MNEMONIC])
    expect(importResult.exitCode).toBe(0)
    const {deriveKeyPairFromMnemonic} = await import('../utils/key-derivation')
    const keyPair = deriveKeyPairFromMnemonic(SITE_MNEMONIC, '')
    site = {keyPair, mnemonic: SITE_MNEMONIC, accountId: keyPair.accountId}
    siteId = `hm://${site.accountId}`
    await registerAccount(ctx.webServerUrl, site, 'Extension Test Site')
    await sleep(2000)

    pkgDir = mkdtempSync(join(tmpdir(), 'seed-ext-pkg-'))
    mkdirSync(join(pkgDir, 'dist'))
    writeFileSync(join(pkgDir, 'seed-extension.json'), JSON.stringify(MANIFEST, null, 2))
    writeFileSync(join(pkgDir, 'dist', 'index.html'), ENTRY_HTML)
    writeFileSync(join(pkgDir, 'README.md'), README_V1)
  }, TEST_TIMEOUT)

  afterAll(async () => {
    try {
      await runCli(['key', 'remove', SITE_KEY_NAME, '--force'])
    } catch {}
    if (pkgDir) rmSync(pkgDir, {recursive: true, force: true})
    await ctx?.cleanup()
  }, TEST_TIMEOUT)

  test(
    'publish --dry-run validates without publishing',
    async () => {
      const result = await runCli(['extension', 'publish', pkgDir, '-k', SITE_KEY_NAME, '--dry-run', '--json'], {
        server: ctx.webServerUrl,
      })
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.id).toBe(`${siteId}/board`)
      expect(data.name).toBe('Test Board')
      expect(data.manifest.entry).toMatch(/^ipfs:\/\/baf/)
      expect(data.manifest.permissions).toEqual(['sign', 'navigate'])
      expect(data.metadata.seedExtension.entry).toBe(data.manifest.entry)
      expect(data.metadata.summary).toBe(MANIFEST.description)

      const missing = await runCli(['document', 'get', `${siteId}/board`, '--json'], {server: ctx.webServerUrl})
      expect(JSON.parse(missing.stdout).type).not.toBe('document')
    },
    TEST_TIMEOUT,
  )

  test(
    'publish rejects an invalid manifest',
    async () => {
      const badDir = mkdtempSync(join(tmpdir(), 'seed-ext-bad-'))
      try {
        mkdirSync(join(badDir, 'dist'))
        writeFileSync(join(badDir, 'seed-extension.json'), JSON.stringify({...MANIFEST, kind: 'widget'}))
        writeFileSync(join(badDir, 'dist', 'index.html'), ENTRY_HTML)
        const result = await runCli(['extension', 'publish', badDir, '-k', SITE_KEY_NAME], {server: ctx.webServerUrl})
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('Invalid extension manifest')
        expect(result.stderr).toContain('kind')
      } finally {
        rmSync(badDir, {recursive: true, force: true})
      }
    },
    TEST_TIMEOUT,
  )

  test(
    'publish creates the extension document with a nested manifest and README body',
    async () => {
      const result = await runCli(['extension', 'publish', pkgDir, '-k', SITE_KEY_NAME, '--json'], {
        server: ctx.webServerUrl,
      })
      if (result.exitCode !== 0) console.log('[test] publish stderr:', result.stderr)
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.action).toBe('created')
      expect(data.id).toBe(`${siteId}/board`)
      expect(data.version).toMatch(/^baf/)
      expect(data.entry).toMatch(/^baf/)
      expect(data.install).toBe(`seed-cli extension install ${siteId}/board --path board -k <sitekey>`)
      extensionId = data.id
      firstVersion = data.version
      entryCid = data.entry

      await sleep(2000)
      const doc = await getDocJson(extensionId)
      expect(doc.type).toBe('document')
      expect(doc.document.version).toBe(firstVersion)
      const meta = doc.document.metadata
      expect(meta.name).toBe('Test Board')
      expect(meta.summary).toBe(MANIFEST.description)
      // The manifest round-trips as a nested object, permissions as a real array.
      expect(meta.seedExtension).toEqual({...MANIFEST, entry: `ipfs://${entryCid}`})

      // README is the body, minus the title heading that became the name.
      const md = await runCli(['document', 'get', extensionId], {server: ctx.webServerUrl})
      expect(md.stdout).toContain('A board extension for the fixture test.')
      // Headings render by depth, so the README's "## Usage" is a top-level heading here.
      expect(md.stdout).toContain('# Usage')
      expect(md.stdout).toContain('Install it.')
      expect(md.stdout).not.toContain('# Test Board')

      // The entry HTML is served by CID from the web server's file proxy.
      const entryRes = await fetch(`${ctx.webServerUrl}/hm/api/file/${entryCid}`)
      expect(entryRes.status).toBe(200)
      expect(await entryRes.text()).toBe(ENTRY_HTML)
    },
    TEST_TIMEOUT,
  )

  test(
    'inspect shows the manifest and refuses non-extensions',
    async () => {
      const result = await runCli(['extension', 'inspect', extensionId, '--json'], {server: ctx.webServerUrl})
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.id).toBe(extensionId)
      expect(data.name).toBe('Test Board')
      expect(data.version).toBe(firstVersion)
      expect(data.manifest.kind).toBe('page')
      expect(data.permissions).toEqual(['sign', 'navigate'])
      expect(data.entry.cid).toBe(entryCid)
      expect(data.entry.url).toBe(`${ctx.webServerUrl}/hm/api/file/${entryCid}`)
      expect(data.readme).toContain('A board extension')

      const text = await runCli(['extension', 'inspect', extensionId], {server: ctx.webServerUrl})
      expect(text.exitCode).toBe(0)
      expect(text.stdout).toContain('Permissions:    sign, navigate')
      expect(text.stdout).toContain(`Entry:          ipfs://${entryCid}`)

      const notExt = await runCli(['extension', 'inspect', siteId], {server: ctx.webServerUrl})
      expect(notExt.exitCode).toBe(1)
      expect(notExt.stderr).toContain('not an extension')
    },
    TEST_TIMEOUT,
  )

  test(
    'install writes a pinned record into the site home document',
    async () => {
      const result = await runCli(
        [
          'extension',
          'install',
          extensionId,
          '--path',
          'board',
          '-k',
          SITE_KEY_NAME,
          '--settings',
          '{"columns":3}',
          '--json',
        ],
        {server: ctx.webServerUrl},
      )
      if (result.exitCode !== 0) console.log('[test] install stderr:', result.stderr)
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.mount).toBe('board')
      expect(data.record).toEqual({ext: extensionId, version: firstVersion, settings: {columns: 3}})
      expect(data.urls.hm).toBe(`${siteId}/board`)
      // The extension document itself lives at /board on this site, so the install shadows it.
      expect(result.stderr).toContain('shadow')

      await sleep(2000)
      const home = await getDocJson(siteId)
      expect(home.document.metadata.extensions.board).toEqual({
        ext: extensionId,
        version: firstVersion,
        settings: {columns: 3},
      })
      // Other metadata on the home document is untouched.
      expect(home.document.metadata.name).toBe('Extension Test Site')
    },
    TEST_TIMEOUT,
  )

  test(
    'install refuses to overwrite without --force and rejects bad mounts',
    async () => {
      const dup = await runCli(['extension', 'install', extensionId, '--path', 'board', '-k', SITE_KEY_NAME], {
        server: ctx.webServerUrl,
      })
      expect(dup.exitCode).toBe(1)
      expect(dup.stderr).toContain('already installed')

      const bad = await runCli(['extension', 'install', extensionId, '--path', 'Bad Path', '-k', SITE_KEY_NAME], {
        server: ctx.webServerUrl,
      })
      expect(bad.exitCode).toBe(1)
      expect(bad.stderr).toContain('Invalid mount path')

      const notExt = await runCli(['extension', 'install', siteId, '--path', 'x', '-k', SITE_KEY_NAME], {
        server: ctx.webServerUrl,
      })
      expect(notExt.exitCode).toBe(1)
      expect(notExt.stderr).toContain('not an extension')
    },
    TEST_TIMEOUT,
  )

  test(
    'list shows the install with the extension name',
    async () => {
      const result = await runCli(['extension', 'list', '-k', SITE_KEY_NAME, '--json'], {server: ctx.webServerUrl})
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.site).toBe(siteId)
      expect(data.extensions).toHaveLength(1)
      expect(data.extensions[0]).toMatchObject({
        mount: 'board',
        ext: extensionId,
        version: firstVersion,
        pinned: true,
        name: 'Test Board',
        permissions: ['sign', 'navigate'],
        latestVersion: firstVersion,
        error: null,
      })

      const bySite = await runCli(['extension', 'list', siteId], {server: ctx.webServerUrl})
      expect(bySite.exitCode).toBe(0)
      expect(bySite.stdout).toContain('/board  Test Board')
      expect(bySite.stdout).toContain(`pinned ${firstVersion}`)
    },
    TEST_TIMEOUT,
  )

  test(
    'update is a no-op while the pinned version is current',
    async () => {
      const result = await runCli(['extension', 'update', '--path', 'board', '-k', SITE_KEY_NAME], {
        server: ctx.webServerUrl,
      })
      expect(result.exitCode).toBe(0)
      expect(result.stdout + result.stderr).toContain('already pinned to the current version')
    },
    TEST_TIMEOUT,
  )

  test(
    'republishing updates the document in place; update re-pins the install',
    async () => {
      writeFileSync(join(pkgDir, 'README.md'), README_V2)
      writeFileSync(
        join(pkgDir, 'seed-extension.json'),
        JSON.stringify({...MANIFEST, version: '0.2.0', permissions: ['sign'], homepage: undefined}),
      )
      const result = await runCli(['extension', 'publish', pkgDir, '-k', SITE_KEY_NAME, '--json'], {
        server: ctx.webServerUrl,
      })
      if (result.exitCode !== 0) console.log('[test] republish stderr:', result.stderr)
      expect(result.exitCode).toBe(0)
      const data = JSON.parse(result.stdout)
      expect(data.action).toBe('updated')
      expect(data.id).toBe(extensionId)
      expect(data.version).not.toBe(firstVersion)
      const secondVersion = data.version

      await sleep(2000)
      const doc = await getDocJson(extensionId)
      expect(doc.document.version).toBe(secondVersion)
      expect(doc.document.genesis).toBe(firstVersion)
      // Changed manifest fields are replaced, dropped ones are removed, the array shrinks.
      expect(doc.document.metadata.seedExtension).toEqual({
        ...MANIFEST,
        version: '0.2.0',
        permissions: ['sign'],
        homepage: undefined,
        entry: `ipfs://${entryCid}`,
      })
      const md = await runCli(['document', 'get', extensionId], {server: ctx.webServerUrl})
      expect(md.stdout).toContain('now updated')
      expect(md.stdout).not.toContain('Usage')
      expect(md.stdout).not.toContain('Install it.')

      // The pinned install still points at the first version until updated.
      const list = await runCli(['extension', 'list', '-k', SITE_KEY_NAME, '--json'], {server: ctx.webServerUrl})
      expect(JSON.parse(list.stdout).extensions[0]).toMatchObject({version: firstVersion, latestVersion: secondVersion})

      const update = await runCli(['extension', 'update', '--path', 'board', '-k', SITE_KEY_NAME, '--json'], {
        server: ctx.webServerUrl,
      })
      if (update.exitCode !== 0) console.log('[test] update stderr:', update.stderr)
      expect(update.exitCode).toBe(0)
      expect(JSON.parse(update.stdout)).toMatchObject({mount: 'board', from: firstVersion, to: secondVersion})

      await sleep(2000)
      const home = await getDocJson(siteId)
      expect(home.document.metadata.extensions.board).toEqual({
        ext: extensionId,
        version: secondVersion,
        settings: {columns: 3},
      })
    },
    TEST_TIMEOUT,
  )

  test(
    'install --force --latest replaces the record and drops stale fields',
    async () => {
      const result = await runCli(
        [
          'extension',
          'install',
          extensionId,
          '--path',
          'board',
          '-k',
          SITE_KEY_NAME,
          '--force',
          '--latest',
          '--title',
          'Board',
          '--no-nav',
          '--json',
        ],
        {server: ctx.webServerUrl},
      )
      if (result.exitCode !== 0) console.log('[test] force install stderr:', result.stderr)
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout).record).toEqual({ext: extensionId, title: 'Board', nav: false})

      await sleep(2000)
      const home = await getDocJson(siteId)
      expect(home.document.metadata.extensions.board).toEqual({ext: extensionId, title: 'Board', nav: false})

      const update = await runCli(['extension', 'update', '--path', 'board', '-k', SITE_KEY_NAME], {
        server: ctx.webServerUrl,
      })
      expect(update.exitCode).toBe(0)
      expect(update.stdout + update.stderr).toContain('follows the latest version')
    },
    TEST_TIMEOUT,
  )

  test(
    'uninstall removes the record',
    async () => {
      const result = await runCli(['extension', 'uninstall', '--path', 'board', '-k', SITE_KEY_NAME], {
        server: ctx.webServerUrl,
      })
      if (result.exitCode !== 0) console.log('[test] uninstall stderr:', result.stderr)
      expect(result.exitCode).toBe(0)

      await sleep(2000)
      const home = await getDocJson(siteId)
      expect(home.document.metadata.extensions?.board).toBeUndefined()
      expect(home.document.metadata.name).toBe('Extension Test Site')

      const list = await runCli(['extension', 'list', '-k', SITE_KEY_NAME, '--json'], {server: ctx.webServerUrl})
      expect(JSON.parse(list.stdout).extensions).toEqual([])

      const again = await runCli(['extension', 'uninstall', '--path', 'board', '-k', SITE_KEY_NAME], {
        server: ctx.webServerUrl,
      })
      expect(again.exitCode).toBe(1)
      expect(again.stderr).toContain('No extension is installed')
    },
    TEST_TIMEOUT,
  )
})
