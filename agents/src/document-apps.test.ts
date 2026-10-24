import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apps from '@/document-apps'
import * as memory from '@/agent-memory'

const directories: string[] = []
function state() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-document-app-test-'))
  directories.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive: true, force: true})
})

describe('document app folders', () => {
  test('collects a folder whole, skips dotfiles, and turns a single HTML file into index.html', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'apps/counter/index.html', '<script src="assets/app.js"></script>')
    memory.writeMemoryFile(dir, 'apps/counter/assets/app.js', 'console.log(1)')
    memory.writeMemoryFile(dir, 'apps/counter/assets/logo.png', new Uint8Array([137, 80, 78, 71]))
    memory.writeMemoryFile(dir, 'apps/counter/.notes.md', 'private')
    const folder = apps.collectDocumentAppFiles(dir, '~/memory/apps/counter/')
    expect(folder.files.map((file) => file.path).sort()).toEqual(['assets/app.js', 'assets/logo.png', 'index.html'])
    expect(folder.bytes).toBe(folder.files.reduce((sum, file) => sum + file.content.byteLength, 0))
    expect(Array.from(folder.files.find((file) => file.path === 'assets/logo.png')!.content)).toEqual([137, 80, 78, 71])

    memory.writeMemoryFile(dir, 'apps/single.html', '<h1>One</h1>')
    expect(apps.collectDocumentAppFiles(dir, '/workspace/apps/single.html')).toEqual({
      files: [{path: 'index.html', content: new TextEncoder().encode('<h1>One</h1>')}],
      bytes: 12,
    })
  })
  test('refuses folders without an index, non-HTML single files, and paths outside memory', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'apps/noindex/app.js', 'x')
    memory.writeMemoryFile(dir, 'apps/data.json', '{}')
    expect(() => apps.collectDocumentAppFiles(dir, 'apps/noindex')).toThrow('index.html')
    expect(() => apps.collectDocumentAppFiles(dir, 'apps/data.json')).toThrow('HTML')
    expect(() => apps.collectDocumentAppFiles(dir, '../outside')).toThrow()
    expect(() => apps.collectDocumentAppFiles(dir, 'apps/missing')).toThrow()
  })
})

describe('document app validation', () => {
  const bundle = (source: string) => [{path: 'index.html', content: new TextEncoder().encode(source)}]
  test('refuses the missing-brace failure before publication without running app code', () => {
    expect(() =>
      apps.validateDocumentApp(
        bundle(
          '<script>globalThis.DO_NOT_RUN = true; button.onclick = async () => { try { await fetch("x") } catch (e) {} );</script>',
        ),
      ),
    ).toThrow('syntax error')
    expect((globalThis as any).DO_NOT_RUN).toBeUndefined()
    const checked = apps.validateDocumentApp(
      bundle(
        '<script src="/.seed/client.js"></script><script>button.onclick = async () => { try { await seed.open("hm://alice/doc") } catch (e) {} };</script>',
      ),
    )
    expect(checked).toMatchObject({
      syntax: 'passed',
      scripts: 1,
      runtimeTested: false,
      interactionTested: false,
      storage: 'device-only',
    })
    expect(checked.sdk.methods).toContain('open')
  })
  test('makes runtime compatibility explicit, permitting bundled desktop assets only when requested', () => {
    const files = [
      ...bundle('<script src="app.js"></script>'),
      {path: 'app.js', content: new TextEncoder().encode('console.log(1)')},
    ]
    expect(() => apps.validateDocumentApp(files)).toThrow('external asset')
    expect(apps.validateDocumentApp(files, 'desktop').target).toBe('desktop')
    expect(() =>
      apps.validateDocumentApp(bundle('<script src="https://cdn.example/a.js"></script>'), 'desktop'),
    ).toThrow('unresolved')
    expect(() => apps.validateDocumentApp(bundle('<script type="module">import x from "./x.js"</script>'))).toThrow(
      'module',
    )
    expect(() => apps.validateDocumentApp(bundle('<style>@import "remote.css";</style>'))).toThrow('CSS')
    expect(() => apps.validateDocumentApp(bundle('<img src="logo.png">'))).toThrow('external asset')
    expect(() => apps.validateDocumentApp(bundle('<script>seed.context()</script>'))).toThrow('include')
    expect(
      apps.validateDocumentApp(bundle('<style>body {background:url("data:image/png;base64,AAA")}</style>')).syntax,
    ).toBe('passed')
    expect(apps.validateDocumentApp(bundle('<script>localStorage.getItem("x")</script>')).warnings[0]).toContain(
      'device only',
    )
  })
})
