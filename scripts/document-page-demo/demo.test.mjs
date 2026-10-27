import assert from 'node:assert/strict'
import {test} from 'node:test'
import {mkdtemp, rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {request as httpRequest} from 'node:http'
import {chromium, firefox, webkit} from 'playwright'
import {startDemo} from './server.mjs'
import {artifactFromOutput} from './agent.mjs'

test('artifact validation rejects malformed output and binds revision to code', () => {
  assert.throws(() => artifactFromOutput({html: '<p>bad</p>'}))
  const input = {title: 'Test', description: 'A test', html: '<html><script>void 0</script></html>'}
  const one = artifactFromOutput(input, {id: 'page'})
  const two = artifactFromOutput({...input, html: input.html + '<!-- changed -->'}, {id: 'page'})
  assert.equal(one.id, two.id)
  assert.notEqual(one.revision, two.revision)
})

test('real browser sandbox contract', {timeout: 300000}, async (t) => {
  const stateDir = await mkdtemp(join(tmpdir(), 'seed-demo-tests-'))
  const demo = await startDemo({hostPort: 0, runnerPort: 0, stateDir})
  t.after(async () => {
    await demo.close()
    await rm(stateDir, {recursive: true, force: true})
  })

  await t.test('server enforces runner headers and rejects cross-origin generation and hostile Host', async () => {
    const runner = await fetch(`${demo.runnerOrigin}/runner`)
    assert.match(runner.headers.get('content-security-policy'), /sandbox allow-scripts;/)
    assert.doesNotMatch(runner.headers.get('content-security-policy'), /allow-same-origin/)
    const response = await fetch(`${demo.hostOrigin}/api/generate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: 'null'},
      body: JSON.stringify({prompt: 'should not run'}),
    })
    assert.equal(response.status, 403)
    const config = await (await fetch(`${demo.hostOrigin}/api/config`)).json()
    assert.equal(
      (
        await fetch(`${demo.hostOrigin}/api/generate`, {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example',
            'X-Seed-Demo-Token': config.csrf,
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await fetch(`${demo.hostOrigin}/api/generate`, {
          method: 'POST',
          headers: {Origin: demo.hostOrigin, 'X-Seed-Demo-Token': config.csrf, 'Content-Type': 'application/json'},
          body: '{',
        })
      ).status,
      400,
    )
    const hostileHostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(
        `${demo.hostOrigin}/api/config`,
        {headers: {Host: 'attacker.invalid'}},
        (response) => {
          response.resume()
          resolve(response.statusCode)
        },
      )
      request.on('error', reject)
      request.end()
    })
    assert.equal(hostileHostStatus, 421)
    assert.equal((await fetch(`${demo.hostOrigin}/example.json`)).status, 404)
    assert.equal((await fetch(`${demo.runnerOrigin}/api/pages`)).status, 404)
  })

  const browserNames = (process.env.DEMO_BROWSERS || 'chromium,firefox,webkit').split(',')
  for (const browserType of [chromium, firefox, webkit].filter((type) => browserNames.includes(type.name()))) {
    await t.test(browserType.name(), {timeout: 90000}, async (t) => {
      const browser = await browserType.launch()
      t.after(() => browser.close())
      const page = await browser.newPage({viewport: {width: 1440, height: 1000}})
      page.setDefaultTimeout(10000)
      await page.goto(demo.hostOrigin)
      await page.getByText('Sandbox active', {exact: true}).waitFor()
      const pageFrame = () => page.frameLocator('#page-frame iframe')

      await t.test('agent-created page runs, saves a note, reloads, and separates accounts and copies', async () => {
        await pageFrame().getByRole('textbox', {name: 'New note'}).fill('A note only Alice should see')
        await pageFrame().getByRole('button', {name: 'Add note', exact: true}).click()
        await pageFrame().getByText('A note only Alice should see', {exact: true}).waitFor()
        await page.getByRole('button', {name: 'Reload page', exact: true}).click()
        await pageFrame().getByText('A note only Alice should see', {exact: true}).waitFor()
        await page.locator('#duplicate').check()
        const copy = page.frameLocator('#copy-frame iframe')
        await copy.getByRole('textbox', {name: 'New note'}).waitFor()
        assert.equal(await copy.getByText('A note only Alice should see', {exact: true}).count(), 0)
        await page.locator('#viewer').selectOption('Bob')
        await pageFrame().getByRole('textbox', {name: 'New note'}).waitFor()
        assert.equal(await pageFrame().getByText('A note only Alice should see', {exact: true}).count(), 0)
        await page.locator('#viewer').selectOption('Alice')
        await pageFrame().getByText('A note only Alice should see', {exact: true}).waitFor()
        await page.locator('#duplicate').uncheck()
      })

      await t.test('read permission is exact, revoked on code update, and logout removes the frame', async () => {
        const read = async () => {
          await page.getByText('Sandbox active', {exact: true}).waitFor()
          const frame = await (await page.locator('#page-frame iframe').elementHandle()).contentFrame()
          await frame.waitForFunction(() => typeof window.seed !== 'undefined')
          return frame
        }
        assert.match(
          await (
            await read()
          ).evaluate(async () => {
            try {
              await seed.resource('project-brief')
              return 'allowed'
            } catch (e) {
              return e.message
            }
          }),
          /Permission denied/,
        )
        await page.locator('#grant').check()
        await page.getByText('Sandbox active', {exact: true}).waitFor()
        assert.equal(
          await (await read()).evaluate(async () => (await seed.resource('project-brief')).title),
          'Alice’s project brief',
        )
        assert.match(
          await (
            await read()
          ).evaluate(async () => {
            try {
              await seed.resource('other-secret')
              return 'allowed'
            } catch (e) {
              return e.message
            }
          }),
          /Permission denied/,
        )
        await page.getByRole('button', {name: 'Simulate a code update'}).click()
        await page.getByText('Sandbox active', {exact: true}).waitFor()
        assert.equal(await page.locator('#grant').isChecked(), false)
        assert.match(
          await (
            await read()
          ).evaluate(async () => {
            try {
              await seed.resource('project-brief')
              return 'allowed'
            } catch (e) {
              return e.message
            }
          }),
          /Permission denied/,
        )
        await pageFrame().getByText('A note only Alice should see', {exact: true}).waitFor()
        await page.locator('#viewer').selectOption('')
        assert.equal(await page.locator('iframe').count(), 0)
        await page.locator('#viewer').selectOption('Alice')
        await page.getByText('Sandbox active', {exact: true}).waitFor()
      })

      await t.test('interactive boundary checks all pass', async () => {
        await page.getByRole('button', {name: 'Run boundary checks'}).click()
        await page.waitForFunction(() => document.querySelectorAll('#check-results li').length === 9)
        assert.equal(await page.locator('#check-results .failed').count(), 0)
      })

      await t.test('hostile code cannot remove sandbox, access a sibling, run workers, or fetch', async () => {
        await page.locator('#duplicate').check()
        await page.frameLocator('#copy-frame iframe').getByRole('textbox', {name: 'New note'}).waitFor()
        const frame = await (await page.locator('#page-frame iframe').elementHandle()).contentFrame()
        const result = await frame.evaluate(async (sink) => {
          const results = {}
          for (const [name, fn] of Object.entries({
            parent: () => parent.document,
            sibling: () => parent.frames[1].document,
            removeSandbox: () => frameElement.removeAttribute('sandbox'),
            storage: () => localStorage.getItem('test'),
            cookie: () => document.cookie,
            topNavigation: () => {
              top.location.href = sink
            },
          })) {
            try {
              fn()
              results[name] = false
            } catch {
              results[name] = true
            }
          }
          try {
            await fetch(sink)
            results.fetch = false
          } catch {
            results.fetch = true
          }
          const workerUrl = URL.createObjectURL(new Blob(['postMessage("running")'], {type: 'text/javascript'}))
          results.worker = await new Promise((resolve) => {
            try {
              const worker = new Worker(workerUrl)
              worker.onmessage = () => {
                worker.terminate()
                resolve(false)
              }
              worker.onerror = (event) => {
                event.preventDefault()
                worker.terminate()
                resolve(true)
              }
            } catch {
              resolve(true)
            }
          })
          URL.revokeObjectURL(workerUrl)
          results.opaque = self.origin === 'null'
          return results
        }, `${demo.runnerOrigin}/sink?signal=blocked`)
        assert.deepEqual(Object.values(result), Array(Object.keys(result).length).fill(true), JSON.stringify(result))
        assert.equal(demo.sinkRequests.includes('blocked'), false)
        assert.equal(page.url(), `${demo.hostOrigin}/`)
        await page.locator('#duplicate').uncheck()
      })

      await t.test('direct runner visits retain the opaque origin and do not boot page code', async () => {
        const direct = await browser.newPage()
        await direct.goto(`${demo.runnerOrigin}/runner`)
        assert.match(await direct.locator('body').innerText(), /Open this page through/)
        assert.equal(
          await direct.evaluate(() => {
            try {
              localStorage.setItem('x', 'x')
              return false
            } catch {
              return true
            }
          }),
          true,
        )
        await direct.close()
      })

      await t.test('storage bounds and forged window messages cannot widen authority', async () => {
        const frame = await (await page.locator('#page-frame iframe').elementHandle()).contentFrame()
        const result = await frame.evaluate(async () => {
          const errors = []
          for (const [key, value] of [
            ['', 'bad'],
            ['x'.repeat(129), 'bad'],
            ['huge', 'x'.repeat(17000)],
          ]) {
            try {
              await seed.storage.set(key, value)
              errors.push('allowed')
            } catch (error) {
              errors.push(error.message)
            }
          }
          parent.postMessage(
            {
              type: 'seed-call',
              id: 'forged',
              method: 'storage.set',
              params: {key: 'forged', value: 'bad', viewer: 'Bob'},
            },
            '*',
          )
          const context = await seed.context()
          return {errors, context, forged: await seed.storage.get('forged')}
        })
        assert.equal(result.errors.length, 3)
        assert.ok(result.errors.every((error) => error !== 'allowed'))
        assert.equal(result.context.viewer, 'Alice')
        assert.equal(result.forged, null)
      })

      await t.test('pending reads cannot deliver data after the instance is revoked', async () => {
        const result = await page.evaluate(async (runnerOrigin) => {
          const {mountApp} = await import('/bridge.js')
          const container = document.createElement('div')
          document.body.append(container)
          let finishRead, markStarted
          const started = new Promise((resolve) => {
            markStarted = resolve
          })
          const events = []
          const session = mountApp({
            container,
            runnerOrigin,
            viewer: 'Alice',
            grants: ['brief'],
            artifact: {
              id: 'revocation',
              title: 'Revocation probe',
              revision: 'v1',
              html: '<html><body><script>seed.resource("brief").then(value => seed.storage.set("leaked", value))</script></body></html>',
            },
            resource: () => {
              markStarted()
              return new Promise((resolve) => {
                finishRead = resolve
              })
            },
            onEvent: (event) => events.push(event),
          })
          await Promise.all([session.ready, started])
          session.destroy('Signed out')
          finishRead('private response')
          // Drain this promise turn: the resource continuation runs before this check.
          await Promise.resolve()
          await Promise.resolve()
          container.remove()
          return {
            requests: events.filter((event) => event.type === 'request').length,
            leaked: localStorage.getItem('seed-page-demo:["Alice","revocation"]:leaked'),
          }
        }, demo.runnerOrigin)
        assert.deepEqual(result, {requests: 0, leaked: null})
      })

      await t.test('own-frame navigation remains a demonstrated disclosure limit', async () => {
        // A response-load event revokes the page but cannot undo an already-sent navigation request.
        // Use a separate context so our demo's pagehide revocation cannot mask browser behavior.
        const probe = await browser.newPage()
        await probe.goto(demo.hostOrigin)
        const nonce = `navigation-${browserType.name()}`
        await probe.evaluate(
          ({runnerOrigin, nonce}) => {
            const frame = document.createElement('iframe')
            frame.id = 'navigation-probe'
            frame.sandbox = 'allow-scripts'
            frame.src = `${runnerOrigin}/runner`
            document.body.append(frame)
          },
          {runnerOrigin: demo.runnerOrigin, nonce},
        )
        const frame = await (await probe.locator('#navigation-probe').elementHandle()).contentFrame()
        await frame.waitForURL(`${demo.runnerOrigin}/runner`)
        await Promise.all([
          frame.waitForURL(`${demo.runnerOrigin}/sink?signal=${nonce}`),
          frame.evaluate((url) => {
            location.href = url
          }, `${demo.runnerOrigin}/sink?signal=${nonce}`),
        ])
        assert.equal(demo.sinkRequests.includes(nonce), true)
        await probe.close()
      })

      await t.test('mobile layout fits the viewport', async () => {
        await page.setViewportSize({width: 390, height: 844})
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      })
    })
  }
})
