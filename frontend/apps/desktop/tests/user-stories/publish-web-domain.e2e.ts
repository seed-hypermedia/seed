/**
 * Publishing a space to a free subdomain from Site Settings, in the packaged app.
 *
 * The app, its daemon and the signed `siteUrl` change are real. Only the remote hosting service is
 * replaced, by a small local server on the port `pnpm package:e2e` bakes in. Publishing sets
 * `siteUrl`, which switches the settings page to its published view while the dialog is open: the
 * dialog must survive that switch and show its success step.
 */
import {createPromiseClient} from '@connectrpc/connect'
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import type {Locator, Page} from '@playwright/test'
import * as fs from 'fs'
import {createServer, type IncomingMessage, type Server, type ServerResponse} from 'http'
import {Daemon} from '../../../../packages/shared/src/client/.generated/daemon/v1alpha/daemon_connect'
import {Documents} from '../../../../packages/shared/src/client/.generated/documents/v3alpha/documents_connect'
import {expect, test} from './fixtures'
import {APP_EXECUTABLE, DAEMON_URL} from './harness'

const HOST_PORT = 58107
const HOST_URL = `http://localhost:${HOST_PORT}`
const SUBDOMAIN = 'story-space'
/** Long enough to read each step in a recording; no delay in normal runs. */
const beat = (win: Page) => (process.env.STORY_VIDEO_DIR ? win.waitForTimeout(1200) : Promise.resolve())

/** Waits briefly for an optional element; `isVisible` alone does not wait. */
const appears = (locator: Locator, timeout: number) =>
  locator.waitFor({state: 'visible', timeout}).then(
    () => true,
    () => false,
  )

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** The parts of the hosting service and of a new site that the publish flow calls. */
function startFakeHost(peerId: string) {
  let registeredAccountUid: string | undefined
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': '*',
      })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'OPTIONS') return send(200, {})
    const route = `${req.method} ${new URL(req.url!, HOST_URL).pathname}`
    const body = await readBody(req)
    if (route === 'GET /api/info') return send(200, {hostDomain: 'hyper.media'})
    if (route === 'POST /api/auth/vault') return send(400, {message: 'No vault in this test'})
    if (route === 'POST /api/auth/code/start') {
      const now = Date.now()
      return send(200, {
        status: 'code-sent',
        email: JSON.parse(body).email,
        binding: 'test-binding',
        expireTime: now + 600_000,
        resendAllowedTime: now + 60_000,
      })
    }
    if (route === 'POST /api/auth/code/verify') {
      return send(200, {
        status: 'success',
        sessionToken: 'test-session',
        userId: 'test-user',
        email: JSON.parse(body).email,
      })
    }
    if (route === 'GET /api/sites') return send(200, [])
    if (route === 'POST /api/sites') {
      return send(200, {
        subdomain: JSON.parse(body).subdomain,
        host: HOST_URL,
        registrationSecret: 'test-secret',
        setupUrl: `${HOST_URL}/hm/register?secret=test-secret`,
      })
    }
    // Reports this daemon's peer id, so registration needs no connection to a second node.
    if (route === 'GET /hm/api/config') return send(200, {peerId, addrs: [], registeredAccountUid})
    if (route === 'POST /hm/api/register') {
      registeredAccountUid = JSON.parse(body).accountUid
      return send(200, {registered: true})
    }
    return send(404, {message: `Not served by the test host: ${route}`})
  })
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject)
    server.listen(HOST_PORT, '127.0.0.1', () => resolve(server))
  })
}

test.skip(!fs.existsSync(APP_EXECUTABLE), 'Needs the packaged app: pnpm package:e2e')

test('publishing to a free subdomain ends on the success step', async ({story}) => {
  test.setTimeout(180_000)
  const {win, state, shot} = story
  const host = await startFakeHost(await daemonPeerId())
  try {
    // The app signs publications as the selected account, which resolves once it has a profile.
    await createPromiseClient(Documents, createGrpcWebTransport({baseUrl: DAEMON_URL})).updateProfile({
      account: state.account,
      profile: {name: state.spaceName},
      signingKeyName: 'story-author',
    })
    await win.reload()
    await expect(win.getByRole('button', {name: 'Account menu'})).toBeVisible({timeout: 30_000})
    await win.getByText('Home', {exact: true}).first().click()
    await expect(win.getByRole('button', {name: 'Publish', exact: true}).first()).toBeVisible({timeout: 30_000})
    // A new space's home is a draft until its first publish, which also offers a web domain.
    const publishHome = win.getByRole('button', {name: 'Publish', exact: true}).first()
    if (await appears(publishHome, 3000)) {
      // The editor has a draft to publish once it has been edited and has autosaved.
      await win.locator('[contenteditable=true]').last().click()
      await win.keyboard.type('Welcome to the story space.')
      await win.waitForTimeout(3000)
      await publishHome.click()
      await win.getByRole('button', {name: 'Publish: Make it live now'}).click()
      const notNow = win.getByRole('button', {name: 'Not now'})
      if (await appears(notNow, 5000)) await notNow.click()
      await expect(notNow).toBeHidden()
    }
    await openWebDomainSettings(win)

    // A previous run on the same appdata leaves the space published.
    const remove = win.getByRole('button', {name: 'Remove Domain from Publication'})
    if (await appears(remove, 2000)) {
      await remove.click()
      await win.getByRole('button', {name: 'Remove Space'}).click()
    }

    await beat(win)
    await win.getByRole('button', {name: 'Publish to Web Domain'}).click()
    const dialog = win.getByRole('dialog')
    await expect(dialog.getByText('Publish to the Web', {exact: true})).toBeVisible()
    await beat(win)
    await dialog.getByRole('button', {name: /Free hyper\.media domain/}).click()

    const subdomain = dialog.getByPlaceholder('my-space-name')
    const email = dialog.getByPlaceholder('me@email.com')
    await expect(subdomain.or(email)).toBeVisible({timeout: 15_000})
    if (await email.isVisible()) {
      await email.fill('tester@example.com')
      await beat(win)
      await dialog.getByRole('button', {name: 'Send Code'}).click()
      await expect(dialog.getByRole('button', {name: 'Verify'})).toBeVisible()
      await win.keyboard.type('1234', {delay: 80})
    }

    await expect(subdomain).toBeVisible({timeout: 15_000})
    await subdomain.fill(SUBDOMAIN)
    await beat(win)
    await dialog.getByRole('button', {name: 'Publish Space'}).click()

    // The page behind the dialog has switched to its published view, so publishing worked...
    await expect(win.getByText('Published at')).toBeVisible({timeout: 30_000})
    await win.waitForTimeout(1000)
    await beat(win)
    await beat(win)
    await shot('publish-web-domain-result')
    // ...and the same dialog goes on to tell the user so.
    await expect(dialog.getByText('Publish to the Web', {exact: true})).toBeHidden({timeout: 1000})
    await expect(dialog.getByText('Published to the Web!')).toBeVisible({timeout: 1000})
  } finally {
    await new Promise((resolve) => host.close(resolve))
    host.closeAllConnections()
  }
})

async function daemonPeerId() {
  const daemon = createPromiseClient(Daemon, createGrpcWebTransport({baseUrl: DAEMON_URL}))
  return (await daemon.getInfo({})).peerId
}

async function openWebDomainSettings(win: Page) {
  await win.getByRole('button', {name: 'Account menu'}).click()
  await win.getByRole('menuitem', {name: 'Space settings'}).click()
  await win.getByText('Web Domain', {exact: true}).first().click()
  await expect(
    win
      .getByRole('button', {name: 'Publish to Web Domain'})
      .or(win.getByRole('button', {name: 'Remove Domain from Publication'})),
  ).toBeVisible()
}
