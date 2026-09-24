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
