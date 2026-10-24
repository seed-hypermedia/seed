import {createServer} from 'node:http'
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {build} from 'esbuild'
import {fileURLToPath} from 'node:url'
import {chromium, firefox, webkit} from 'playwright'

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../../../packages/shared/src/document-app-sandbox.ts', import.meta.url))],
  bundle: true,
  minify: true,
  format: 'esm',
  write: false,
})
const code = bundle.outputFiles[0].text
const {documentAppRunnerHTML, DOCUMENT_APP_SANDBOX_CSP} = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
)
const engines = {chromium, firefox, webkit}

for (const engine of (process.env.APP_TEST_BROWSERS || 'chromium,firefox,webkit').split(',')) {
  test(`same-origin document app: ${engine}`, async (t) => {
    let origin
    const server = createServer((req, res) => {
      if (req.url.startsWith('/hm/app-runner')) {
        res.writeHead(200, {'Content-Type': 'text/html', 'Content-Security-Policy': DOCUMENT_APP_SANDBOX_CSP})
        res.end(documentAppRunnerHTML(origin))
      } else if (req.url === '/runtime.js') {
        res.writeHead(200, {'Content-Type': 'text/javascript'})
        res.end(code)
      } else if (req.url === '/') {
        res.writeHead(200, {'Content-Type': 'text/html'})
        res.end(
          '<!doctype html><div id="app"></div><script type="module">import {mountDocumentApp} from "/runtime.js"; window.mountDocumentApp = mountDocumentApp</script>',
        )
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`
    const browser = await engines[engine].launch({headless: true})
    t.after(async () => {
      await browser.close()
      await new Promise((resolve) => server.close(resolve))
    })
    const page = await browser.newPage()
    await page.goto(origin)
    await page.waitForFunction(() => window.mountDocumentApp)
    const hmid = 'hm://alice/apps/hello'
    async function mount(
      account = 'Alice',
      document = hmid,
      revision = 'v1',
      html = '<button id="hello">Hello</button>',
    ) {
      await page.evaluate(
        async ({account, document: id, revision, html}) => {
          window.session?.destroy()
          window.session = window.mountDocumentApp({
            hostHandlesReads: false,
            container: window.document.querySelector('#app'),
            html,
            context: {protocol: 1, account, document: id, version: revision, app: revision},
            storage: localStorage,
            profile: async () => (account ? {id: account, name: `${account} Profile`} : null),
            resource: async () => ({title: 'Own document'}),
          })
          await window.session.ready
        },
        {account, document, revision, html},
      )
      return page.frames().find((frame) => frame.url().includes('/hm/app-runner'))
    }
    await t.test('production defaults gate identity, own documents and saved state through the host', async () => {
      await page.evaluate(async () => {
        window.session?.destroy()
        window.readCalls = []
        window.session = window.mountDocumentApp({
          container: document.querySelector('#app'),
          html: '<p>Permission test</p>',
          storage: localStorage,
          context: {protocol: 1, account: 'Alice', document: 'hm://alice/app', version: 'v1', app: 'v1'},
          profile: async () => {
            throw new Error('Bypassed profile gate')
          },
          resource: async () => {
            throw new Error('Bypassed document gate')
          },
          content: async (method) => {
            window.readCalls.push(method)
            throw new Error('App permission denied.')
          },
        })
        await window.session.ready
      })
      const frame = page.frames().find((frame) => frame.url().includes('/hm/app-runner'))
      const results = await frame.evaluate(async () => {
        const results = await Promise.allSettled([
          seed.context(),
          seed.profile(),
          seed.storage.get('private'),
          seed.resource('hm://alice/app'),
        ])
        return results.map((result) => (result.status === 'rejected' ? result.reason.message : 'LEAKED'))
      })
      assert.deepEqual(results, Array(4).fill('App permission denied.'))
      assert.deepEqual(await page.evaluate(() => window.readCalls), ['context', 'profile', 'storage.get', 'resource'])
      assert.equal((await frame.evaluate(() => seed.runtime())).authority, 'scoped-app-permissions')
    })
    await t.test(
      'storage belongs to viewer and resource, survives revisions, and cannot choose another namespace',
      async () => {
        let frame = await mount()
        await frame.evaluate(() => seed.storage.set('note', 'private note'))
        frame = await mount('Alice', hmid, 'v2')
        assert.equal(await frame.evaluate(() => seed.storage.get('note')), 'private note')
        frame = await mount('Bob')
        assert.equal(await frame.evaluate(() => seed.storage.get('note')), null)
        frame = await mount('Alice', 'hm://alice/apps/other')
        assert.equal(await frame.evaluate(() => seed.storage.get('note')), null)
        assert.equal(
          await frame.evaluate(() => seed.storage.get('seed-app:["Alice","hm://alice/apps/hello"]:note')),
          null,
        )
        frame = await mount(null)
        assert.equal(await frame.evaluate(() => seed.storage.get('note')), null)
      },
    )
    await t.test('storage rejects malformed keys, oversized values, and excess keys', async () => {
      const frame = await mount('Alice', 'hm://alice/apps/limits')
      const errors = await frame.evaluate(async () => {
        const errors = []
        for (const key of ['', 'x'.repeat(129), {viewer: 'Bob'}]) {
          try {
            await seed.storage.get(key)
          } catch (e) {
            errors.push(e.message)
          }
        }
        try {
          await seed.storage.set('large', 'x'.repeat(17000))
        } catch (e) {
          errors.push(e.message)
        }
        for (let n = 0; n < 64; n++) await seed.storage.set(String(n), n)
        try {
          await seed.storage.set('overflow', 65)
        } catch (e) {
          errors.push(e.message)
        }
        return errors
      })
      assert.deepEqual(errors, [
        'Invalid storage key',
        'Invalid storage key',
        'Invalid storage key',
        'Storage value too large',
        'Storage key limit reached',
      ])
    })
    await t.test('same-host iframe cannot read the parent, native storage, cookies, or fetch', async () => {
      const frame = await mount()
      const result = await frame.evaluate(async () => {
        const denied = {}
        for (const [key, read] of Object.entries({
          parent: () => parent.document.body,
          storage: () => localStorage.length,
          cookies: () => document.cookie,
        })) {
          try {
            read()
            denied[key] = false
          } catch {
            denied[key] = true
          }
        }
        try {
          await fetch('/')
          denied.fetch = false
        } catch {
          denied.fetch = true
        }
        return denied
      })
      assert.deepEqual(result, {parent: true, storage: true, cookies: true, fetch: true})
    })
    await t.test('profile API and previously published profile URLs return the selected viewer', async () => {
      let frame = await mount('Alice')
      assert.deepEqual(await frame.evaluate(() => seed.profile()), {id: 'Alice', name: 'Alice Profile'})
      assert.deepEqual(await frame.evaluate(() => seed.resource('hm://Alice/:profile')), {
        id: 'Alice',
        name: 'Alice Profile',
      })
      assert.match(
        await frame.evaluate(() => seed.resource('hm://Bob/:profile').catch((e) => e.message)),
        /not available/,
      )
      frame = await mount(null)
      assert.equal(await frame.evaluate(() => seed.profile()), null)
    })
    await t.test('executes inline app code after bridge bootstrap and accepts the desktop bridge include', async () => {
      const frame = await mount(
        'Alice',
        hmid,
        'v1',
        '<h1 id="greeting"></h1><script src="/.seed/client.js"></script><script>seed.resource("hm://Alice/:profile").then(p => document.querySelector("h1").textContent = "Hello, " + p.name)</script>',
      )
      await frame.waitForFunction(() => document.querySelector('h1').textContent === 'Hello, Alice Profile')
      assert.equal(await frame.locator('h1').textContent(), 'Hello, Alice Profile')
    })
    await t.test('without an account-access handler only its own document is readable', async () => {
      const frame = await mount()
      assert.deepEqual(await frame.evaluate((id) => seed.resource(id), hmid), {title: 'Own document'})
      assert.match(
        await frame.evaluate(() => seed.resource('hm://other/private').catch((e) => e.message)),
        /not available/,
      )
      assert.match(await frame.evaluate(() => seed.directory('hm://alice').catch((e) => e.message)), /not available/)
    })
    await t.test(
      'anchors and SDK navigation leave the frame through the host, preserving explicit servers',
      async () => {
        await page.evaluate(async () => {
          window.session.destroy()
          window.links = []
          window.session = window.mountDocumentApp({
            hostHandlesReads: false,
            container: document.querySelector('#app'),
            storage: localStorage,
            context: {protocol: 1, account: 'Alice', document: 'hm://alice/app', version: 'v1', app: 'v1'},
            html: '<a id="hm" href="hm://alice/doc?v=version#block"><span>Document</span></a><a id="web" target="_blank" href="https://private.example/hm/alice/doc?v=version#block">Website</a>',
            profile: async () => null,
            resource: async () => ({}),
            content: async (method, params) => {
              window.links.push({method, params})
              return null
            },
          })
          await window.session.ready
        })
        const frame = page.frames().find((frame) => frame.url().includes('/hm/app-runner'))
        const runtime = await frame.evaluate(() => seed.runtime())
        assert.equal(runtime.sdkVersion, '1.2.0')
        assert.match(runtime.sdkDigest, /^[a-f0-9]{64}$/)
        assert.equal(runtime.storage.synced, false)
        assert.equal(
          await frame.evaluate(() => seed.stringify({ts: 123n, bytes: new Uint8Array([1, 2])}, 0)),
          '{"ts":"123","bytes":[1,2]}',
        )
        await frame.locator('#hm span').click()
        await frame.locator('#web').click()
        await frame.locator('#hm').click({modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control']})
        await frame.locator('#hm').click({button: 'middle'})
        await page.waitForFunction(() => window.links.length === 4)
        assert.deepEqual(await page.evaluate(() => window.links), [
          {method: 'open', params: {url: 'hm://alice/doc?v=version#block', newWindow: false}},
          {method: 'open', params: {url: 'https://private.example/hm/alice/doc?v=version#block', newWindow: true}},
          {method: 'open', params: {url: 'hm://alice/doc?v=version#block', newWindow: true}},
          {method: 'open', params: {url: 'hm://alice/doc?v=version#block', newWindow: true}},
        ])
        assert.match(frame.url(), /hm\/app-runner/)
      },
    )
    await t.test('account SDK transports binary signatures, blob payloads and bigint document results', async () => {
      await page.evaluate(async () => {
        window.session.destroy()
        const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
        window.verifyAppSignature = async (data, sig) =>
          crypto.subtle.verify('Ed25519', keys.publicKey, new Uint8Array(sig), new Uint8Array(data))
        window.accountCalls = []
        window.session = window.mountDocumentApp({
          hostHandlesReads: false,
          container: document.querySelector('#app'),
          storage: localStorage,
          context: {protocol: 1, account: 'Alice', document: 'hm://alice/apps/hello', version: 'v1', app: 'v1'},
          html: '<p>Account app</p>',
          profile: async () => null,
          resource: async () => ({}),
          content: async (method, params) => {
            window.accountCalls.push(method)
            if (method === 'signer.sign')
              return new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, params.data))
            if (method === 'hm.createDocumentBlobs')
              return {blobs: [{cid: 'test', data: new Uint8Array([1, 2, 3])}], ts: 123n}
            if (method === 'publish')
              return {cids: [params.input.blobs[0].cid], size: params.input.blobs[0].data.byteLength}
            if (method === 'request') return {key: params.key, input: params.input}
            return null
          },
        })
        await window.session.ready
      })
      const frame = page.frames().find((frame) => frame.url().includes('/hm/app-runner'))
      const result = await frame.evaluate(async () => {
        await seed.permissions.request()
        const signature = await seed.signer.sign(new Uint8Array([4, 5, 6]))
        const document = await seed.hm.createDocumentBlobs({space: 'Alice', path: '/new', ops: []})
        const published = await seed.publish({blobs: document.blobs})
        const resource = await seed.request('Account', 'Bob')
        await seed.permissions.revoke()
        return {
          signature: [...signature],
          binary: document.blobs[0].data instanceof Uint8Array,
          ts: String(document.ts),
          published,
          resource,
        }
      })
      assert.equal(
        await page.evaluate((result) => window.verifyAppSignature([4, 5, 6], result.signature), result),
        true,
      )
      assert.equal(result.binary, true)
      assert.equal(result.ts, '123')
      assert.deepEqual(result.published, {cids: ['test'], size: 3})
      assert.deepEqual(result.resource, {key: 'Account', input: 'Bob'})
      assert.deepEqual(await page.evaluate(() => window.accountCalls), [
        'permissions.request',
        'signer.sign',
        'hm.createDocumentBlobs',
        'publish',
        'request',
        'permissions.revoke',
      ])
      assert.match(
        await frame.evaluate(() => seed.signer.sign(new Uint8Array(8 * 1024 * 1024)).catch((e) => e.message)),
        /too large/i,
      )
    })
    await t.test(
      'content calls use the host bridge and closing the frame revokes pending signing approval',
      async () => {
        await page.evaluate(async () => {
          window.session.destroy()
          window.contentCalls = []
          window.approvalAborted = false
          window.session = window.mountDocumentApp({
            hostHandlesReads: false,
            container: document.querySelector('#app'),
            storage: localStorage,
            context: {protocol: 1, account: 'Alice', document: 'hm://alice/apps/hello', version: 'v1', app: 'v1'},
            html: '<p>Comment app</p>',
            profile: async () => null,
            resource: async () => ({}),
            content: async (method, params, signal) => {
              window.contentCalls.push({method, params})
              if (method !== 'comments.create') return [{block: {type: 'Paragraph', text: params.markdown}}]
              window.approvalStarted = true
              return new Promise((resolve) => {
                signal.addEventListener(
                  'abort',
                  () => {
                    window.approvalAborted = true
                    resolve({commentId: 'cancelled'})
                  },
                  {once: true},
                )
              })
            },
          })
          await window.session.ready
        })
        const frame = page.frames().find((frame) => frame.url().includes('/hm/app-runner'))
        assert.deepEqual(await frame.evaluate(() => seed.hm.parseMarkdown('Hello')), [
          {block: {type: 'Paragraph', text: 'Hello'}},
        ])
        await frame.evaluate(() => {
          seed.comments.create({content: [{block: {type: 'Paragraph', text: 'Review me'}}]}).catch(() => {})
        })
        await page.waitForFunction(() => window.approvalStarted)
        assert.equal(await page.evaluate(() => window.contentCalls[1].method), 'comments.create')
        await page.evaluate(() => window.session.destroy())
        assert.equal(await page.evaluate(() => window.approvalAborted), true)
      },
    )
    await t.test('revocation discards late results before they reach app code', async () => {
      await page.evaluate(async () => {
        window.session.destroy()
        window.pendingRead = new Promise((resolve) => {
          window.resolveRead = resolve
        })
        window.session = window.mountDocumentApp({
          hostHandlesReads: false,
          container: document.querySelector('#app'),
          storage: localStorage,
          context: {protocol: 1, account: 'Alice', document: 'hm://alice/apps/hello', version: 'v1', app: 'v1'},
          html: '<script>seed.resource("hm://alice/apps/hello").then(v => seed.storage.set("late",v))</script>',
          profile: async () => null,
          resource: () => {
            window.readStarted = true
            return window.pendingRead
          },
        })
        await window.session.ready
      })
      await page.waitForFunction(() => window.readStarted)
      await page.evaluate(() => {
        window.session.destroy()
        window.resolveRead('secret')
      })
      const frame = await mount()
      assert.equal(await frame.evaluate(() => seed.storage.get('late')), null)
    })
    await t.test('direct runner visit remains sandboxed and does not load an app', async () => {
      const direct = await browser.newPage()
      await direct.goto(`${origin}/hm/app-runner`)
      assert.match(await direct.locator('body').textContent(), /Open this app through its Seed document/)
      assert.equal(
        await direct.evaluate(() => {
          try {
            localStorage.length
            return false
          } catch {
            return true
          }
        }),
        true,
      )
      await direct.close()
    })
  })
}
