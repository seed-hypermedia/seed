/**
 * Hello Signer — the smallest useful Seed extension.
 *
 * It connects to the host, shows the live context, and has one button per
 * bridge capability so you can watch requests and responses go by. Use it to
 * check that a host implementation is wired up correctly.
 */

import {
  applyTheme,
  connect,
  injectBaseStyles,
  type ExtensionContext,
  type SeedExtension,
} from '@seed-hypermedia/extension-sdk'
import {describeError} from './errors'
import './styles.css'

injectBaseStyles()

const app = document.getElementById('app')!

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {className?: string} = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  Object.assign(node, props)
  for (const child of children) node.append(child)
  return node
}

// ── On-page log ──

const logList = el('ul', {className: 'log'})

function log(kind: 'request' | 'response' | 'error', label: string, payload?: unknown) {
  const text = payload === undefined ? '' : ' ' + JSON.stringify(payload, jsonReplacer)
  const item = el('li', {className: kind}, [`${new Date().toLocaleTimeString()} ${kind.toUpperCase()} ${label}${text}`])
  logList.prepend(item)
}

function jsonReplacer(_key: string, value: unknown) {
  if (value instanceof Uint8Array) return `<${value.length} bytes>`
  if (typeof value === 'bigint') return value.toString()
  return value
}

/** Run a bridge call, logging the request, its result and any error. */
async function run<T>(label: string, params: unknown, fn: () => Promise<T>): Promise<T | undefined> {
  log('request', label, params)
  try {
    const result = await fn()
    log('response', label, result)
    return result
  } catch (error) {
    log('error', label, describeError(error))
    return undefined
  }
}

// ── UI ──

function render(seed: SeedExtension) {
  const userLabel = el('span', {className: 'user'})
  const contextPre = el('pre')

  seed.onContext((context: ExtensionContext) => {
    applyTheme(context)
    userLabel.textContent = context.user
      ? `Signed in as ${context.user.name || context.user.accountId}`
      : 'Not signed in'
    contextPre.textContent = JSON.stringify(context, jsonReplacer, 2)
  })

  // Sign arbitrary text
  const signInput = el('input', {value: 'Hello from an extension', placeholder: 'Text to sign'})
  const signResult = el('div', {className: 'result'})
  const signButton = el('button', {textContent: 'Sign this text'})
  signButton.onclick = async () => {
    const result = await run('sign.data', {text: signInput.value}, () =>
      seed.sign.data(signInput.value, 'Demonstrate signing from the Hello Signer extension'),
    )
    if (result) {
      signResult.textContent = `signer=${result.signer} account=${result.accountId} signature=${toHex(
        result.signature,
      )}`
    }
  }

  // Comment on the site home document
  const commentInput = el('textarea', {value: 'Hello from the **Hello Signer** extension!'})
  const commentResult = el('div', {className: 'result'})
  const commentButton = el('button', {textContent: 'Post comment on home doc'})
  commentButton.onclick = async () => {
    const targetId = `hm://${seed.context.site.uid}`
    const result = await run('sign.comment', {targetId}, () =>
      seed.sign.comment({targetId, markdown: commentInput.value}),
    )
    if (result) commentResult.textContent = `Published ${result.commentId}`
  }

  // Storage counter
  const counterLabel = el('span', {className: 'result', textContent: 'counter: ?'})
  const refreshCounter = async () => {
    const value = await run('storage.get', {key: 'counter'}, () => seed.storage.get('counter'))
    counterLabel.textContent = `counter: ${value ?? '(unset)'}`
  }
  const incrementButton = el('button', {textContent: 'Increment stored counter'})
  incrementButton.onclick = async () => {
    const current = Number((await seed.storage.get('counter').catch(() => null)) ?? 0)
    await run('storage.set', {key: 'counter', value: current + 1}, () =>
      seed.storage.set('counter', String(current + 1)),
    )
    await refreshCounter()
  }
  const resetButton = el('button', {textContent: 'Reset counter'})
  resetButton.onclick = async () => {
    await run('storage.remove', {key: 'counter'}, () => seed.storage.remove('counter'))
    await refreshCounter()
  }
  const keysButton = el('button', {textContent: 'List keys'})
  keysButton.onclick = () => run('storage.keys', {}, () => seed.storage.keys())

  // UI helpers
  const toastButton = el('button', {textContent: 'Show toast'})
  toastButton.onclick = () => run('ui.toast', {}, () => seed.toast('Hello from the extension', 'success'))
  const titleButton = el('button', {textContent: 'Set title'})
  titleButton.onclick = () =>
    run('ui.setTitle', {}, () => seed.setTitle(`Hello Signer ${new Date().toLocaleTimeString()}`))

  // Navigation
  const homeButton = el('button', {textContent: 'Navigate to site home'})
  homeButton.onclick = () => {
    const url = `hm://${seed.context.site.uid}`
    return run('navigate', {url}, () => seed.navigate(url))
  }
  const externalButton = el('button', {textContent: 'Open hyper.media'})
  externalButton.onclick = () =>
    run('openExternal', {url: 'https://hyper.media'}, () => seed.openExternal('https://hyper.media'))

  // In-extension routing
  const routeInput = el('input', {value: 'page/one', placeholder: 'sub/path'})
  const routeButton = el('button', {textContent: 'setRoute'})
  routeButton.onclick = () => {
    const subPath = routeInput.value.split('/').filter(Boolean)
    return run('route.set', {subPath}, () => seed.setRoute(subPath, {from: 'hello-signer'}))
  }

  const clearLog = el('button', {textContent: 'Clear log'})
  clearLog.onclick = () => logList.replaceChildren()

  app.replaceChildren(
    el('header', {className: 'header'}, [el('h1', {textContent: 'Hello Signer'}), userLabel]),
    el('main', {}, [
      el('section', {}, [
        el('h2', {textContent: 'Sign data'}),
        el('div', {className: 'row'}, [signInput, signButton]),
        signResult,
      ]),
      el('section', {}, [
        el('h2', {textContent: 'Comment on the site home document'}),
        commentInput,
        el('div', {className: 'row'}, [commentButton]),
        commentResult,
      ]),
      el('section', {}, [
        el('h2', {textContent: 'Storage'}),
        el('div', {className: 'row'}, [incrementButton, resetButton, keysButton, counterLabel]),
      ]),
      el('section', {}, [el('h2', {textContent: 'UI'}), el('div', {className: 'row'}, [toastButton, titleButton])]),
      el('section', {}, [
        el('h2', {textContent: 'Navigation'}),
        el('div', {className: 'row'}, [homeButton, externalButton]),
        el('div', {className: 'row'}, [routeInput, routeButton]),
      ]),
      el('section', {}, [el('h2', {textContent: 'Context (live)'}), contextPre]),
      el('section', {}, [el('h2', {textContent: 'Log'}), el('div', {className: 'row'}, [clearLog]), logList]),
    ]),
  )

  if (seed.hasPermission('storage')) void refreshCounter()
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Boot ──

app.replaceChildren(el('main', {}, [el('p', {textContent: 'Connecting to the Seed host…'})]))

connect()
  .then((seed) => {
    log('response', 'hello', seed.context)
    render(seed)
  })
  .catch((error) => {
    app.replaceChildren(
      el('main', {}, [
        el('p', {textContent: `Could not connect: ${describeError(error)}`}),
        el('p', {textContent: 'Open this page through a Seed site that has the extension installed, or use ?extdev=.'}),
      ]),
    )
  })
