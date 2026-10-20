import {describe, expect, it} from 'vitest'
import {executeBrowserCommand} from '../app-browser-agent'

const commands = [
  {action: 'snapshot'},
  {action: 'screenshot', document: 'doc'},
  {action: 'click', document: 'doc', ref: 'e1'},
  {action: 'type', document: 'doc', ref: 'e1', text: 'hi'},
  {action: 'press', document: 'doc', key: 'Enter'},
  {action: 'scroll', document: 'doc', y: 10},
  {action: 'navigate', document: 'doc', url: 'https://example.com/'},
  {action: 'archive', document: 'doc'},
] as const

/** Captures the page script a command injects, without an Electron guest. */
async function injectedScript(command: (typeof commands)[number], pageUrl = 'https://example.com/'): Promise<string> {
  let code = ''
  const guest = {
    getURL: () => pageUrl,
    executeJavaScriptInIsolatedWorld: async (_world: number, scripts: {code: string}[]) => {
      code = scripts[0]!.code
      return {browserError: 'stop'}
    },
  }
  await executeBrowserCommand(guest as never, command as never, {
    assertActive: () => {},
    navigate: () => {},
    archive: async () => ({id: 'draft'}),
  }).catch(() => {})
  return code
}

describe('injected browser script', () => {
  it.each(commands)('parses for $action', async (command) => {
    const code = await injectedScript(command)
    expect(code).not.toBe('')
    expect(() => new Function(code)).not.toThrow()
  })

  it('never offers password fields for typing', async () => {
    const code = await injectedScript(commands[3])
    expect(code).toContain("['text','search','email','url','tel','number']")
  })
})

describe('origin checks', () => {
  it('refuses results reported from a website the user did not allow', async () => {
    const guest = {
      getURL: () => 'https://allowed.example/',
      executeJavaScriptInIsolatedWorld: async () => ({url: 'https://other.example/', text: 'secret'}),
    }
    await expect(
      executeBrowserCommand(
        guest as never,
        {action: 'snapshot'},
        {
          assertActive: () => {},
          assertOrigin: (url) => {
            if (new URL(url).origin !== 'https://allowed.example') throw new Error('not allowed')
          },
          navigate: () => {},
          archive: async () => ({id: 'draft'}),
        },
      ),
    ).rejects.toThrow('not allowed')
  })
})

describe('form submission guards', () => {
  /** Runs the injected script against jsdom with the layout APIs it needs stubbed in. */
  function runInPage(code: string): Record<string, any> {
    const rect = {x: 10, y: 10, width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30, toJSON: () => ({})}
    const style = {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      clipPath: 'none',
      clip: 'auto',
      overflow: 'visible',
      color: 'rgb(0, 0, 0)',
      fontSize: '16px',
    }
    const originals = {
      getComputedStyle: window.getComputedStyle,
      elementRect: Element.prototype.getBoundingClientRect,
      rangeRect: Range.prototype.getBoundingClientRect,
      rangeRects: Range.prototype.getClientRects,
      scrollIntoView: Element.prototype.scrollIntoView,
      elementFromPoint: document.elementFromPoint,
    }
    let target: Element | null = null
    window.getComputedStyle = () => style as unknown as CSSStyleDeclaration
    Element.prototype.getBoundingClientRect = () => rect
    Range.prototype.getBoundingClientRect = () => rect
    Range.prototype.getClientRects = () => [rect] as unknown as DOMRectList
    Element.prototype.scrollIntoView = function () {
      target = this
    }
    document.elementFromPoint = () => target
    try {
      return new Function(`return ${code}`)()
    } finally {
      window.getComputedStyle = originals.getComputedStyle
      Element.prototype.getBoundingClientRect = originals.elementRect
      Range.prototype.getBoundingClientRect = originals.rangeRect
      Range.prototype.getClientRects = originals.rangeRects
      Element.prototype.scrollIntoView = originals.scrollIntoView
      document.elementFromPoint = originals.elementFromPoint
    }
  }

  async function clickResult(html: string, name: string) {
    document.body.innerHTML = html
    document.querySelector('form')!.addEventListener('submit', (event) => event.preventDefault())
    const snapshot = runInPage(await injectedScript(commands[0], location.href))
    expect(snapshot.browserError).toBeUndefined()
    const ref = snapshot.elements.find((element: {name: string}) => element.name === name)?.ref
    expect(ref).toBeDefined()
    return runInPage(await injectedScript({action: 'click', document: snapshot.document, ref}, location.href))
  }

  it('refuses to click a submit button whose form posts to another website', async () => {
    const result = await clickResult(
      '<form action="https://evil.example/collect"><button type="submit">Send</button></form>',
      'Send',
    )
    expect(result.browserError).toContain('submits the form to another website')
  })

  it('refuses a cross-origin formaction and honours an empty one', async () => {
    const result = await clickResult(
      '<form action="/ok"><button type="submit" formaction="https://evil.example/collect">Send</button></form>',
      'Send',
    )
    expect(result.browserError).toContain('submits the form to another website')
    const emptied = await clickResult(
      '<form action="https://evil.example/c"><button type="submit" formaction="">Send</button></form>',
      'Send',
    )
    expect(emptied.browserError).toBeUndefined()
  })

  it('clicks a submit button whose form posts to the page itself', async () => {
    const result = await clickResult('<form action="/search"><button type="submit">Go</button></form>', 'Go')
    expect(result.browserError).toBeUndefined()
    expect(result.summary).toBe('Browser click completed')
  })
})
